import { createHash } from 'node:crypto';
import {
    LlmAdapter, LlmError, ToolCallId, type ContentBlock, type FinishReason, type GenerateOptions, type StreamChunk, type TokenUsage, type LlmFailure,
} from '@deepseek-ai/dsh-llm';
import { abortable, addUsage } from './stream.js';
import { completionPath } from './completion_path.js';
import { completionData } from './completion_data.js';
import { Config, type ProtocolConfig } from './config.js';
import { continuation, projectRequest, withIntellisense } from './projection.js';
import { cleanControls, execBlocks, joinContinuation, MarkerBuffer, nativeCallStart, proseEnd, stripNativeCalls } from './syntax.js';
import type { AuditEvents, Position } from './events.js';

/** @brief Completion query data is scoped to the current request and cancellation signal. */
export interface CompletionQuery {
    prefix: string;
    context: string;
    sessionId: GenerateOptions['sessionId'];
    signal: AbortSignal;
}

/** @brief Dependencies shared by production session writers and scripted fake-adapter tests. */
export interface ProtocolHost {
    complete(query: CompletionQuery): Promise<{ kind: string; text: string } | undefined>;
    /** @brief Persist a native system-prompt update before the continuation reaches the model. */
    promptUpdated?(text: string, signal: AbortSignal): string | void | Promise<string | void>;
    audit<K extends keyof AuditEvents>(type: K, event: AuditEvents[K]): void | Promise<void>;
}

/** @brief One emitted block with marker-safe deltas and an exact assembled block-end. */
class TextOutput {
    private text = '';
    private opened = false;
    private buffer: MarkerBuffer;

    constructor(private index: number, private type: 'text' | 'reasoning', marker: string) { this.buffer = new MarkerBuffer(marker); }

    /** @brief Produce only text that is safe to persist irreversibly. */
    push(text: string, final = false): StreamChunk[] {
        const clean = this.buffer.push(text, final);
        if (!clean) return [];
        const chunks: StreamChunk[] = [];
        if (!this.opened) { chunks.push({ type: 'block-start', index: this.index, blockType: this.type }); this.opened = true; }
        this.text += clean;
        chunks.push(this.type === 'text' ? { type: 'text-delta', index: this.index, text: clean } : { type: 'reasoning-delta', index: this.index, text: clean });
        return chunks;
    }

    /** @brief Flush buffered ordinary text and close the block exactly once. */
    end(): StreamChunk[] {
        const chunks = this.push('', true);
        if (this.opened) chunks.push({ type: 'block-end', index: this.index, block: { type: this.type, text: this.text } });
        return chunks;
    }
}

/** @brief Check cancellation at every yield, including consumer pauses between adjacent chunks. */
function* checked(chunks: StreamChunk[], signal: AbortSignal): Generator<StreamChunk> {
    for (const chunk of chunks) { signal.throwIfAborted(); yield chunk; }
}

/** @brief Request-local text execution adapter; the native loop exclusively owns actual execution. */
export class TextExecAdapter extends LlmAdapter {
    readonly config: ProtocolConfig;

    constructor(private inner: Pick<LlmAdapter, 'stream'>, private host: ProtocolHost, private position: Position, config: unknown = {}) {
        super();
        this.config = Config.parse(config);
    }

    /** @brief Rewrite logged calls, buffer source and synthesize one executable call only after a normal stop. */
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (options.stop?.length) throw new LlmError('Text execution requires an unmodified terminal marker; stop sequences are unsupported', 'UNSUPPORTED_OPTION');
        let initial = projectRequest(options);
        const controller = new AbortController();
        const signal = controller.signal;
        const abort = (): void => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        let request = { ...initial, signal };
        let buffered = '';
        let total: TokenUsage | undefined;
        let index = 0;
        const prose = new TextOutput(index++, 'text', this.config.marker);
        let proseOffset = 0;
        let repaired = false;
        let previousQuery: string | undefined;
        let repetitions = 0;
        let discardedPrefix = 0;
        const originals: string[] = [];
        const audit = async (code: string, reason: AuditEvents['exec/rewrite']['reason'], failure?: LlmFailure): Promise<void> => {
            const blocks = execBlocks(buffered);
            const selected = blocks.filter(block => !block.abandoned).at(-1);
            await this.host.audit('exec/rewrite', {
                ...this.position, original: [...originals], code, hash: createHash('sha256').update(code).digest('hex'),
                discardedTail: selected ? buffered.slice(selected.end) : '',
                discardedBlocks: blocks.filter(block => block !== selected).map(block => buffered.slice(block.start, block.end)), reason, ...(failure ? { failure } : {}),
            });
        };
        try {
            for (let segment = 0, continuations = 0; continuations < this.config.maxSegments; segment++) {
                signal.throwIfAborted();
                const streamProse = buffered.length === 0;
                let response = '';
                let finish: FinishReason | undefined;
                let usage: TokenUsage | undefined;
                const reasoning = new Map<number, TextOutput>();
                const textDeltas = new Set<number>();
                const iterator = this.inner.stream(request)[Symbol.asyncIterator]();
                try {
                    while (true) {
                        const next = await abortable(iterator.next(), signal);
                        if (next.done) break;
                        const chunk = next.value;
                        signal.throwIfAborted();
                        if (finish) throw new LlmError('Upstream emitted data after finish', 'INVALID_STREAM');
                        if (chunk.type === 'finish') { finish = chunk.reason; continue; }
                        if (chunk.type === 'usage') { usage = chunk.usage; continue; }
                        if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call') || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) throw new LlmError('Model must emit an exec fence rather than a native tool call', 'INVALID_STREAM');
                        if (chunk.type === 'reasoning-delta') {
                            let output = reasoning.get(chunk.index);
                            if (!output) { output = new TextOutput(index++, 'reasoning', this.config.marker); reasoning.set(chunk.index, output); }
                            yield* checked(output.push(chunk.text), signal);
                        }
                        let delta = '';
                        if (chunk.type === 'text-delta') { delta = chunk.text; textDeltas.add(chunk.index); }
                        else if (chunk.type === 'block-end' && chunk.block.type === 'text' && !textDeltas.has(chunk.index)) delta = chunk.block.text;
                        response += delta;
                        if (buffered.length + response.length > this.config.maxBufferedChars) throw new LlmError('Text execution output exceeds configured buffer', 'OUTPUT_LIMIT');
                        if (streamProse && delta) {
                            const end = proseEnd(response);
                            yield* checked(prose.push(response.slice(proseOffset, end)), signal);
                            proseOffset = end;
                        }
                    }
                } finally {
                    originals.push(response);
                    total = addUsage(total, usage);
                    // Abort owns upstream cancellation. Do not block on return() of an adapter that ignores its signal.
                    if (signal.aborted) void iterator.return?.().catch(() => { /* Upstream cleanup rejection is secondary to the explicit abort. */ });
                    else await iterator.return?.();
                }
                signal.throwIfAborted();
                for (const output of reasoning.values()) yield* checked(output.end(), signal);
                if (buffered) {
                    const joined = joinContinuation(buffered, response);
                    buffered = joined.text;
                    discardedPrefix = joined.discarded;
                } else buffered = response;
                if (buffered.length > this.config.maxBufferedChars) throw new LlmError('Text execution output exceeds configured buffer', 'OUTPUT_LIMIT');
                if (finish?.kind !== 'stop') throw new LlmError(`Upstream did not stop normally (${finish?.kind ?? 'missing finish'})`, 'INVALID_FINISH');
                if (nativeCallStart(buffered) !== undefined && /<\|BREAK(?:\|(?!>)[\s\S]*?)?\|>/.test(buffered)) {
                    buffered = stripNativeCalls(buffered);
                }
                if (nativeCallStart(buffered) !== undefined) {
                    if (this.config.malformedPolicy === 'repair-once' && !repaired) {
                        await audit('', 'error');
                        request = { ...continuation(initial, buffered, '', segment, this.config.marker), signal };
                        buffered = ''; proseOffset = 0; repaired = true;
                        continuations++;
                        continue;
                    }
                    throw new LlmError('Native DSML tool syntax requires an exec fence', 'MALFORMED_OUTPUT');
                }
                const blocks = execBlocks(buffered);
                const last = blocks.at(-1);
                if ((!blocks.length && buffered.trimEnd().endsWith(this.config.marker))
                    || blocks.some(block => !block.abandoned && block.closed && block.code.includes(this.config.marker)
                        && (block !== last || !block.code.trimEnd().endsWith(this.config.marker)))) {
                    if (this.config.malformedPolicy === 'repair-once' && !repaired) {
                        await audit('', 'error');
                        request = { ...continuation(initial, buffered, '', segment, this.config.marker), signal };
                        buffered = ''; proseOffset = 0; repaired = true;
                        continuations++;
                        continue;
                    }
                    throw new LlmError('Completion marker requires a command path inside an exec fence', 'MALFORMED_OUTPUT');
                }
                const selected = blocks.filter(block => !block.abandoned).at(-1);
                if (last && !last.abandoned) {
                    const trimmed = last.code.trimEnd();
                    if (trimmed.endsWith(this.config.marker)) {
                        const code = trimmed.slice(0, -this.config.marker.length);
                        const path = completionPath(code).replace(/\.$/, '');
                        repetitions = path === previousQuery ? repetitions + 1 : 1;
                        previousQuery = path;
                        if (repetitions >= 3) throw new LlmError('Repeated completion query limit reached', 'COMPLETION_LOOP');
                        buffered = buffered.slice(0, buffered.indexOf('\n', last.start) + 1) + code;
                        const context = code.slice(-this.config.contextChars);
                        const started = performance.now();
                        const info = await abortable(this.host.complete({ prefix: code, context, sessionId: options.sessionId, signal }), signal);
                        signal.throwIfAborted();
                        const full = info?.text ?? 'No additional information.';
                        const injected = completionData(full, this.config.marker, this.config.maxInfoChars);
                        await this.host.audit('exec/intellisense', {
                            ...this.position, marker: this.config.marker, segment, sessionId: options.sessionId, prefix: code, context, info: full,
                            injected, elapsedMs: performance.now() - started, discardedPrefixLength: discardedPrefix,
                        });
                        signal.throwIfAborted();
                        const regenerated = await this.host.promptUpdated?.(injected, signal);
                        initial = withIntellisense(initial, injected, segment, regenerated ?? undefined);
                        signal.throwIfAborted();
                        request = { ...continuation(initial, buffered, '', segment), signal };
                        continue;
                    }
                    if (!last.closed) {
                        if (/<\|LINEBREAK(?:\|(?!>)[\s\S]*?)?\|>\s*$/.test(last.code)) {
                            buffered = cleanControls(buffered, this.config.marker);
                            request = { ...continuation(initial, buffered, 'Continue on the next line.', segment), signal };
                            continuations++;
                            continue;
                        }
                        if (this.config.malformedPolicy === 'repair-once' && !repaired) {
                            await audit('', 'error');
                            request = { ...continuation(initial, buffered, '', segment, this.config.marker), signal };
                            buffered = ''; proseOffset = 0; repaired = true;
                            continuations++;
                            continue;
                        }
                        throw new LlmError('Unclosed exec fence', 'MALFORMED_OUTPUT');
                    }
                }
                const code = selected ? cleanControls(selected.code, this.config.marker) : '';
                await audit(code, selected ? 'exec' : blocks.length ? 'abandoned' : 'prose');
                signal.throwIfAborted();
                if (streamProse) {
                    const end = blocks[0]?.start ?? buffered.length;
                    yield* checked(prose.push(buffered.slice(proseOffset, end)), signal);
                }
                if (!selected && blocks.length) {
                    const answer = buffered.slice(blocks.at(-1)!.end).replace(/^\s*```[ \t]*(?:\r?\n|$)/, '');
                    yield* checked(prose.push(answer), signal);
                }
                yield* checked(prose.end(), signal);
                if (selected) {
                    const id = ToolCallId(`exec-${this.position.turn}-${this.position.step}-${createHash('sha256').update(code).digest('hex')}`);
                    const block: ContentBlock = { type: 'tool-call', id, name: 'exec', arguments: JSON.stringify({ code }) };
                    yield* checked([
                        { type: 'block-start', index, blockType: 'tool-call' },
                        { type: 'tool-call-delta', index, id, name: 'exec', argumentsDelta: block.arguments },
                        { type: 'block-end', index, block },
                    ], signal);
                }
                if (total) yield* checked([{ type: 'usage', usage: total }], signal);
                yield* checked([{ type: 'finish', reason: { kind: selected ? 'tool-calls' : 'stop' } }], signal);
                return;
            }
            throw new LlmError('Continuation segment limit reached', 'COMPLETION_LOOP');
        } catch (error) {
            if (signal.aborted) return;
            const failure = { code: error instanceof LlmError ? error.code : 'TEXT_EXEC_FAILED', message: error instanceof Error ? error.message : String(error) };
            await audit('', 'error', failure);
            yield* checked(prose.end(), signal);
            if (total) yield* checked([{ type: 'usage', usage: total }], signal);
            yield { type: 'finish', reason: { kind: 'error', failure } };
        } finally {
            options.signal?.removeEventListener('abort', abort);
            controller.abort();
        }
    }
}
