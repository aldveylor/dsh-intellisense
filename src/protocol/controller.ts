import { createAssistantMessage, createSystemMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { mergeContinuation, processMarkers } from './markers.js';
import type { CompletionResult } from '../typescript/completion.js';
import type { ExecutionResult } from '../runtime/session.js';

/** @brief Host capabilities used by the independently testable continuation controller. */
export interface ControllerHost {
    generate(options: GenerateOptions): AsyncIterable<StreamChunk>;
    complete(source: string): Promise<CompletionResult>;
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
export async function runConversation(host: ControllerHost, initial: GenerateOptions, identity: string, limit = 12): Promise<LogicalResponse> {
    let prefix = '';
    let request = initial;
    for (let round = 0; round < limit; round++) {
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
        const segment = processMarkers(response);
        prefix = mergeContinuation(prefix, segment.source);
        if (segment.kind === 'break') {
            await host.journal({ round, prefix, response });
            return { source: prefix, output: '', abandoned: true };
        }
        if (segment.kind === 'code') {
            await host.journal({ round, prefix, response });
            const result = await host.execute(identity, prefix);
            return { source: prefix, output: result.output, abandoned: false };
        }
        const context = segment.kind === 'intellisense' ? (await host.complete(prefix)).context : 'Continue on the next line. The buffered source remains unexecuted.';
        if (segment.kind === 'line') prefix += '\n';
        await host.journal({ round, prefix, response, context });
        request = { ...initial, messages: continuationHistory(initial.messages, prefix, context, initial.provider, initial.model), tools: [], toolHistory: undefined };
    }
    throw new Error('IntelliSense continuation limit exceeded; buffered source was not executed');
}
