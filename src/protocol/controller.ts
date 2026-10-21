import { createAssistantMessage, createSystemMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { mergeContinuation, processMarkers, type Segment } from './markers.js';
import type { CompletionResult } from '../typescript/completion.js';
import type { ExecutionResult } from '../runtime/session.js';

/** @brief Host capabilities used by the independently testable continuation controller. */
export interface ControllerHost {
    generate(options: GenerateOptions): AsyncIterable<StreamChunk>;
    trace?(event: string, details: Record<string, unknown>): void;
    complete(source: string): Promise<CompletionResult>;
    validate?(source: string): Promise<string | undefined>;
    execute(id: string, source: string): Promise<ExecutionResult>;
    journal(record: { round: number; prefix: string; response: string; context?: string }): Promise<void>;
}

/** @brief One logical response spanning voluntarily terminated generation segments. */
export interface LogicalResponse { source: string; output: string; abandoned: boolean }

/** @brief Reconstruct internal history with system context before the unfinished assistant prefix. */
export function continuationHistory(original: RequestMessage[], prefix: string, context: string, provider: string, model: string): RequestMessage[] {
    if (!prefix) return [...original, createSystemMessage(`${context}\nWrite executable TypeScript using the completion context. No source has been buffered or executed.`)];
    return [
        ...original,
        createSystemMessage(`${context}\nContinue the unfinished TypeScript at the exact interruption point. Emit only the suffix, without repeating source. The following assistant prefix has not executed.`),
        createAssistantMessage({ content: [{ type: 'text', text: prefix }], source: { provider, model } }),
    ];
}

/** @brief Consume full responses, then request completion or execute one complete logical program. */
export async function runConversation(host: ControllerHost, initial: GenerateOptions, identity: string): Promise<LogicalResponse> {
    let prefix = '';
    const discoveries: string[] = [];
    const completionPositions = new Map<string, number>();
    let request = initial;
    for (let round = 0; ; round++) {
        initial.signal?.throwIfAborted();
        let response = '';
        let reason: string | undefined;
        let ended = '';
        let nativeCall = false;
        for await (const chunk of host.generate(request)) {
            if (chunk.type === 'text-delta') response += chunk.text;
            if (chunk.type === 'block-end' && chunk.block.type === 'text') ended += chunk.block.text;
            if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) nativeCall = true;
            if (chunk.type === 'finish') reason = chunk.reason.kind;
        }
        if (!response) response = ended;
        host.trace?.('ts.response', { round, response, reason, nativeCall });
        if (nativeCall || /<\/?\s*[|｜]+\s*DSML\b/i.test(response)) {
            const context = 'Invalid response format: native tool calls and DSML wrappers are disabled. Output raw executable TypeScript only. To inspect a namespace, write its name followed by a dot and <|INTELLISENSE|>, then stop immediately. For example: unknown.<|INTELLISENSE|>. Use only names listed in the VM context. The rejected response has not executed.';
            await host.journal({ round, prefix, response, context });
            request = {
                ...initial,
                messages: prefix ? continuationHistory(initial.messages, prefix, context, initial.provider, initial.model) : [...initial.messages, createSystemMessage(context)],
                tools: [], toolHistory: undefined,
            };
            continue;
        }
        if (reason !== 'stop') throw new Error(`Generation did not finish normally (${reason ?? 'missing finish'}); incomplete input was not executed`);
        let segment: Segment;
        try { segment = processMarkers(response); }
        catch (error) {
            host.trace?.('ts.parse.error', { round, response, error: error instanceof Error ? error.message : String(error) });
            const context = `${discoveries.join('\n\n')}\nInvalid control marker format: ${error instanceof Error ? error.message : String(error)}. The rejected response has not executed. Return only TypeScript up to one terminal control marker and stop immediately; never append an explanation after a marker.\nRejected response:\n${response}`;
            await host.journal({ round, prefix, response, context });
            request = { ...initial, messages: continuationHistory(initial.messages, prefix, context, initial.provider, initial.model), tools: [], toolHistory: undefined };
            continue;
        }
        prefix = mergeContinuation(prefix, segment.source);
        host.trace?.('ts.parse', { round, kind: segment.kind, source: prefix });
        if (segment.kind === 'break') {
            await host.journal({ round, prefix, response });
            return { source: prefix, output: '', abandoned: true };
        }
        if (segment.kind === 'code') {
            host.trace?.('ts.validate.request', { round, source: prefix });
            const error = await host.validate?.(prefix);
            host.trace?.('ts.validate.result', { round, valid: !error, diagnostics: error });
            if (error) {
                const context = `${discoveries.join('\n\n')}\nTypeScript validation failed before execution. No code from the buffered program has executed. Replace the entire buffered program with corrected executable TypeScript only; do not include prose or Markdown fences.\nRejected source:\n${prefix}\nCompiler diagnostics:\n${error}`;
                await host.journal({ round, prefix, response, context });
                prefix = '';
                request = { ...initial, messages: [...initial.messages, createSystemMessage(context)], tools: [], toolHistory: undefined };
                continue;
            }
            await host.journal({ round, prefix, response });
            host.trace?.('ts.execute.request', { round, source: prefix });
            const result = await host.execute(identity, prefix);
            host.trace?.('ts.execute.result', { round, output: result.output, declarations: result.declarations });
            return { source: prefix, output: result.output, abandoned: false };
        }
        if (segment.kind === 'intellisense') {
            const occurrences = (completionPositions.get(prefix) ?? 0) + 1;
            completionPositions.set(prefix, occurrences);
            host.trace?.('intellisense.request', { round, source: prefix, occurrences });
            if (occurrences >= 3) throw new Error('IntelliSense repeated the same position three times; buffered source was not executed');
            if (occurrences > 1) {
                const context = `${discoveries.join('\n\n')}\nThe same cursor has already been inspected; its current VM members are listed above. No source has executed. Discard the unfinished buffer and write a complete executable TypeScript program that answers the original request. To list namespace members without invoking tools, use Object.keys(namespace) as the final executable expression. Do not repeat the same discovery request.`;
                await host.journal({ round, prefix, response, context });
                prefix = '';
                request = { ...initial, messages: [...initial.messages, createSystemMessage(context)], tools: [], toolHistory: undefined };
                continue;
            }
            const completion = await host.complete(prefix);
            host.trace?.('intellisense.result', { round, source: prefix, ...completion });
            discoveries.push(completion.context);
            if (discoveries.length > 3) discoveries.shift();
        }
        const context = [...discoveries, ...(segment.kind === 'line' ? ['Continue on the next line. The buffered source remains unexecuted.'] : [])].join('\n\n');
        if (segment.kind === 'line') {
            prefix += '\n';
        }
        await host.journal({ round, prefix, response, context });
        request = { ...initial, messages: continuationHistory(initial.messages, prefix, context, initial.provider, initial.model), tools: [], toolHistory: undefined };
    }
}
