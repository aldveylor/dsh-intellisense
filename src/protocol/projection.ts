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
export function continuation(options: GenerateOptions, prefix: string, info: string, segment: number, repairMarker?: string): GenerateOptions {
    return {
        ...options,
        messages: mergeRoles([
            ...options.messages,
            {
                role: 'assistant', id: MessageId(`text-exec-prefix-${segment}`),
                source: { kind: 'model', provider: options.provider, model: options.model }, content: [{ type: 'text', text: prefix }],
            },
            { role: 'user', content: [{ type: 'text', text: repairMarker
                ? `The previous execution syntax was malformed and was not executed. Native tool calls and DSML tags are unsupported. Rewrite the complete response. For IntelliSense discovery, output an OPEN js:exec block and stop IMMEDIATELY at ${repairMarker}. Do NOT append a newline, closing fence, parentheses or explanation after the marker. For namespace members, put a dot before the marker. For example, output exactly these two lines and end the response:
\x60\x60\x60js:exec
std.${repairMarker}
Only when the program is ready to execute without requesting IntelliSense should you close its exec fence. If no execution or discovery is needed, answer directly in prose.`
                : `${info}\nContinue exactly from the interruption without repeating the prefix. If execution is intended, output the remaining code and its closing fence. For discovery only, emit <|BREAK|> to abandon the buffered code without execution; then open a new exec block to query another path, or answer the original request directly in prose.` }] },
        ]),
    };
}

/** @brief Use the fully regenerated prompt for this request while retaining immutable logged history. */
export function withIntellisense(options: GenerateOptions, text: string, segment: number, regenerated?: string): GenerateOptions {
    const previous = [options.system, ...options.messages.filter(message => message.role === 'system').map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('\n'))].filter(Boolean).join('\n\n');
    const prompt = regenerated ?? [previous, text].filter(Boolean).join('\n\n');
    return {
        ...options,
        system: undefined,
        messages: [
            { role: 'system', id: MessageId(`text-exec-prompt-${segment}`), source: { kind: 'system-prompt' }, content: [{ type: 'text', text: prompt }] },
            ...options.messages.filter(message => message.role !== 'system'),
        ],
    };
}
