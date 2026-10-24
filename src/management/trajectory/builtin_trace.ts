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

/** @brief Show builtin schemas and code results as read-only Markdown in native trajectory details. */
export function builtinTraceDefinition(t: (key: LocaleKey) => string): ConversationNodeDefinitionInput<ContextMessageNode> {
    return {
        kind: 'intellisense-builtin', target: 'trajectory',
        match: event => builtinRecord(event) ? { id: String(event.seq), role: 'start' } : null,
        start: (_context, match) => {
            const data = builtinRecord(match.event);
            if (!data) throw new Error('Expected builtin plugin record');
            const label = `${data.name}${data.isError ? ` · ${t('builtin_error')}` : ''}`;
            return {
                kind: 'context', seq: match.event.seq, time: match.event.time, form: 'notice',
                producer: { role: 'inject', label },
                source: { kind: 'exec/intellisense', form: 'notice', summary: label },
                content: [{ type: 'text', text: `${label}\n\n${t('builtin_schema')}\n\n${codeBlock(data.schema, 'json')}\n\n${t('builtin_arguments')}\n\n${codeBlock(data.arguments, 'json')}\n\n${t('intellisense_result')} (${Math.round(data.elapsedMs)} ms)\n\n${codeBlock(data.result, data.language)}` }],
            };
        },
        update: context => context.state,
        buildViewNode: (context): TrajectoryConversationViewNode | null => context.state === undefined ? null : {
            key: context.key, kind: context.kind, id: context.id, target: 'trajectory',
            anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'unresolved' },
            data: { kind: 'node', node: context.state },
        },
    };
}
