import { createHash } from 'node:crypto';
import { BlockAssembler, LlmAdapter, LlmError, MessageId, type ContentBlock, type GenerateOptions, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { ProtocolHost } from './adapter.js';
import type { Position } from './events.js';
import { completionPath } from './completion_path.js';
import { completionData } from './completion_data.js';
import { Config, type ProtocolConfig } from './config.js';
import { cleanControls, stripNativeCalls } from './syntax.js';
import { withIntellisense } from './projection.js';
import { abortable, addUsage } from './stream.js';

/** @brief Namespace discovery and execution veto for native tools, without requiring a JavaScript VM. */
export class NamespaceAdapter extends LlmAdapter {
    private config: ProtocolConfig;

    constructor(private inner: Pick<LlmAdapter, 'stream'>, private host: ProtocolHost, private position: Position, config: unknown = {}) {
        super();
        this.config = Config.parse(config);
    }

    /** @brief Buffer tool dispatch until completion controls and BREAK have been resolved. */
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const controller = new AbortController();
        const signal = controller.signal;
        const abort = (): void => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        let request = { ...options, signal };
        let total: TokenUsage | undefined;
        let previous = '';
        let repeated = 0;
        const originals: string[] = [];
        try {
            if (options.stop?.length) throw new LlmError('Namespace controls require unmodified terminal markers', 'UNSUPPORTED_OPTION');
            for (let segment = 0; ; segment++) {
                signal.throwIfAborted();
                const assembler = new BlockAssembler();
                let finished = false;
                let size = 0;
                const iterator = this.inner.stream(request)[Symbol.asyncIterator]();
                try {
                    while (true) {
                        const next = await abortable(iterator.next(), signal);
                        if (next.done) break;
                        if (finished) throw new LlmError('Upstream emitted data after finish', 'INVALID_STREAM');
                        size += JSON.stringify(next.value).length;
                        if (size > this.config.maxBufferedChars) throw new LlmError('Namespace output exceeds configured buffer', 'OUTPUT_LIMIT');
                        assembler.push(next.value);
                        finished = next.value.type === 'finish';
                    }
                } finally {
                    if (signal.aborted) void iterator.return?.().catch(() => {});
                    else await iterator.return?.();
                }
                signal.throwIfAborted();
                total = addUsage(total, assembler.usage);
                const blocks = assembler.blocks();
                const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('');
                originals.push(JSON.stringify(blocks));
                const veto = blocks.some(block => /<\|BREAK(?:\|(?!>)[\s\S]*?)?\|>/.test(block.type === 'tool-call' ? block.arguments : block.type === 'text' || block.type === 'reasoning' ? block.text : ''));
                if (!finished || !['stop', 'tool-calls'].includes(assembler.finish.kind)) throw new LlmError('Namespace output did not finish normally', 'INVALID_FINISH');
                if (!veto && text.trimEnd().endsWith(this.config.marker)) {
                    const prefix = text.trimEnd().slice(0, -this.config.marker.length);
                    const path = completionPath(prefix).replace(/\.$/, '');
                    repeated = path === previous ? repeated + 1 : 1;
                    previous = path;
                    if (repeated >= 3) throw new LlmError('Repeated completion query limit reached', 'COMPLETION_LOOP');
                    const context = prefix.slice(-this.config.contextChars);
                    const started = performance.now();
                    const info = await abortable(this.host.complete({ prefix, context, sessionId: options.sessionId, signal }), signal);
                    const full = info?.text ?? 'No additional information.';
                    const injected = completionData(full, this.config.marker, this.config.maxInfoChars);
                    await this.host.audit('exec/intellisense', { ...this.position, marker: this.config.marker, segment, sessionId: options.sessionId, prefix, context, info: full, injected, elapsedMs: performance.now() - started, discardedPrefixLength: 0 });
                    const regenerated = await this.host.promptUpdated?.(injected, signal);
                    request = { ...withIntellisense(request, injected, segment, regenerated ?? undefined), signal };
                    request.messages = [...request.messages, {
                        role: 'user', source: { kind: 'user' }, id: MessageId(`namespace-continue-${segment}`), content: [{ type: 'text', text: 'Continue the original request using the supplied IntelliSense. The interrupted discovery text was not executed.' }],
                    }];
                    continue;
                }
                await this.host.audit('exec/rewrite', { ...this.position, original: originals, code: '', hash: createHash('sha256').update('').digest('hex'), discardedTail: '', discardedBlocks: veto ? [JSON.stringify(blocks)] : [], reason: veto ? 'abandoned' : 'prose' });
                let index = 0;
                let hasCalls = false;
                for (const original of blocks) {
                    if (veto && original.type === 'tool-call') continue;
                    let block: ContentBlock = original;
                    if (block.type === 'text' || block.type === 'reasoning') {
                        const clean = cleanControls(veto ? stripNativeCalls(block.text) : block.text, this.config.marker);
                        block = { ...block, text: clean };
                    }
                    signal.throwIfAborted();
                    yield { type: 'block-start', index, blockType: block.type };
                    signal.throwIfAborted();
                    yield { type: 'block-end', index: index++, block };
                    hasCalls ||= block.type === 'tool-call';
                }
                signal.throwIfAborted();
                if (total) yield { type: 'usage', usage: total };
                signal.throwIfAborted();
                yield { type: 'finish', reason: { kind: hasCalls ? 'tool-calls' : 'stop' } };
                return;
            }
        } catch (error) {
            if (signal.aborted) return;
            const failure = { code: error instanceof LlmError ? error.code : 'NAMESPACE_FAILED', message: error instanceof Error ? error.message : String(error) };
            await this.host.audit('exec/rewrite', { ...this.position, original: originals, code: '', hash: '', discardedTail: '', discardedBlocks: [], reason: 'error', failure });
            signal.throwIfAborted();
            if (total) yield { type: 'usage', usage: total };
            signal.throwIfAborted();
            yield { type: 'finish', reason: { kind: 'error', failure } };
        } finally {
            options.signal?.removeEventListener('abort', abort);
            controller.abort();
        }
    }
}
