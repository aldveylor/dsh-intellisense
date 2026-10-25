import type { ContextMessageNode, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import type { BuiltinEvent } from '../../protocol/events.js';
import type { LocaleKey } from '../locale/locale.js';
import { codeBlock } from '../../protocol/code_block.js';

export { codeBlock } from '../../protocol/code_block.js';

/** @brief Validate durable builtin records before projecting them into the trajectory. */
function builtinRecord(event: { type: string; data: unknown; ignorable?: boolean }): BuiltinEvent | undefined {
    if (event.type !== 'plugin:ts_intellisense/builtin' || event.ignorable !== true || !event.data || typeof event.data !== 'object') return;
    const value = event.data as Partial<BuiltinEvent>;
    if (![value.name, value.callId, value.schema, value.arguments, value.result].every(field => typeof field === 'string')
        || !['typescript', 'json', 'text'].includes(value.language ?? '') || typeof value.elapsedMs !== 'number' || typeof value.isError !== 'boolean') return;
    return value as BuiltinEvent;
}

/** @brief Project each builtin audit into an inspectable trajectory context row. */
export function builtinTraceDefinition(_t: (key: LocaleKey) => string): ConversationNodeDefinitionInput<ContextMessageNode> {
    return {
        kind: 'ts-intellisense-builtin', target: 'trajectory',
        match: event => builtinRecord(event) ? { id: String(event.seq), role: 'start' } : null,
        start: (_context, match) => {
            const record = builtinRecord(match.event)!;
            return {
                kind: 'context', seq: Number(match.event.seq), time: match.event.time,
                source: { name: record.name }, producer: { role: 'inject', label: record.name }, form: null,
                content: [{ type: 'text', text: `${record.name} · ${Math.round(record.elapsedMs)} ms\n\nSchema\n\n${codeBlock(record.schema, 'json')}\n\nArguments\n\n${codeBlock(record.arguments, 'json')}\n\n${record.isError ? 'Execution failed' : 'Result'}\n\n${codeBlock(record.result, record.language)}` }],
            };
        },
        update: context => context.state,
        buildViewNode: context => context.state ? {
            key: context.key, kind: context.kind, id: context.id, target: 'trajectory', anchorSeq: context.state.seq,
            location: context.start!.location, data: { kind: 'node', node: context.state },
        } satisfies TrajectoryConversationViewNode : null,
    };
}
