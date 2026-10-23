import type { ContextMessageNode, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import type {} from '../../protocol/events.js';
import type { LocaleKey } from '../locale/locale.js';

/** @brief Project durable completion queries into ordinary read-only trajectory context rows. */
export function intellisenseTraceDefinition(t: (key: LocaleKey) => string): ConversationNodeDefinitionInput<ContextMessageNode> {
    return {
        kind: 'text-ptc-intellisense', target: 'trajectory',
        match: {
            'exec/intellisense': event => ({ id: String(event.seq), role: 'start' }),
        },
        start: (_context, match) => {
            if (match.event.type !== 'exec/intellisense') throw new Error('Expected exec/intellisense');
            const { seq, time, data } = match.event;
            const marker = data.marker ?? '<|INTELLISENSE|>';
            const label = `${marker} · ${t('intellisense_trace')}`;
            return {
                kind: 'context', seq, time, form: 'notice',
                producer: { role: 'inject', label },
                source: { kind: 'exec/intellisense', form: 'notice', summary: label },
                content: [{ type: 'text', text: `${label}\n\n${t('intellisense_query')}\n${data.prefix}\n\n${t('intellisense_result')} (${Math.round(data.elapsedMs)} ms)\n${data.info}` }],
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
