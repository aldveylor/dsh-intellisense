import { MessageId, LlmError, type GenerateOptions, type RequestMessage, type ContentBlock } from '@deepseek-ai/dsh-llm';
import { escapeData } from './syntax.js';

/** @brief Project logged exec calls into fenced text and their results into user-role data, deterministically. */
export function projectRequest(options: GenerateOptions): GenerateOptions {
    const calls = new Set<string>();
    const messages: RequestMessage[] = [];
    for (const message of options.messages) {
        if (message.role === 'developer') {
            const content = message.content.filter(block => block.type !== 'tool-addition' && block.type !== 'tool-removal');
            if (content.length) messages.push({ ...message, content });
        } else if (message.role === 'assistant') {
            const transformed = message.content.some(block => block.type === 'tool-call' && block.name === 'exec');
            if (!transformed) { messages.push(message); continue; }
            const content: ContentBlock[] = message.content.map(block => {
                if (block.type !== 'tool-call' || block.name !== 'exec') return block;
                const args: unknown = JSON.parse(block.arguments);
                if (!args || typeof args !== 'object' || !('code' in args) || typeof args.code !== 'string') throw new LlmError('Invalid logged exec arguments', 'INVALID_REQUEST');
                calls.add(block.id);
                return { type: 'text', text: `\x60\x60\x60js:exec\n${args.code}\n\x60\x60\x60` };
            });
            const { replayState: _replay, ...source } = message.source;
            messages.push({ ...message, source, content });
        } else if (message.role === 'tool' && calls.has(message.toolCallId)) {
            const value = message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n');
            messages.push({
                role: 'user', id: message.id, source: { kind: 'exec-result', form: 'notice', summary: 'Program execution result' },
                content: [{ type: 'text', text: `<exec-result id="${escapeData(message.toolCallId)}" is-error="${message.isError === true}">${escapeData(value)}</exec-result>` }],
            });
        } else messages.push(message);
    }
    return { ...options, messages: mergeRoles(messages), tools: options.tools?.filter(tool => tool.name !== 'exec'), toolHistory: undefined };
}

/** @brief Coalesce adjacent user/assistant roles without mutating any logged message. */
export function mergeRoles(messages: RequestMessage[]): RequestMessage[] {
    const merged: RequestMessage[] = [];
    for (const message of messages) {
        const previous = merged.at(-1);
        if (previous && previous.role === message.role && (message.role === 'user' || message.role === 'assistant')) {
            const left = typeof previous.content === 'string' ? [{ type: 'text' as const, text: previous.content }] : previous.content;
            const right = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
            merged[merged.length - 1] = { ...previous, content: [...left, ...right] };
        } else merged.push(message);
    }
    return merged;
}

/** @brief Add a deterministic continuation pair using the supported assistant-history/user-instruction fallback. */
export function continuation(options: GenerateOptions, prefix: string, info: string, segment: number, repair = false): GenerateOptions {
    return {
        ...options,
        messages: mergeRoles([
            ...options.messages,
            {
                role: 'assistant', id: MessageId(`text-exec-prefix-${segment}`),
                source: { kind: 'model', provider: options.provider, model: options.model }, content: [{ type: 'text', text: prefix }],
            },
            { role: 'user', content: [{ type: 'text', text: repair
                ? 'The previous execution syntax was malformed and was not executed. Native tool calls and DSML tags are unsupported. Rewrite the complete response with one closed js:exec or ts:exec block at the end, calling tools through the JavaScript runtime namespaces. If a signature is unknown, use the configured completion marker inside the open exec block. If no execution is needed, answer directly in prose.'
                : `${info}\nContinue exactly from the interruption. Output only the remaining code and its closing fence. Do not repeat the prefix.` }] },
        ]),
    };
}
