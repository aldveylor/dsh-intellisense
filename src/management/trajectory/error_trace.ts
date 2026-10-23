import type { ContextMessageNode, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import { failureRecord } from '../../protocol/session_records.js';
import type { LocaleKey } from '../locale/locale.js';

/** @brief Project terminal protocol failures into durable read-only trajectory context rows. */
export function errorTraceDefinition(t: (key: LocaleKey) => string): ConversationNodeDefinitionInput<ContextMessageNode> {
    return {
        kind: 'text-ptc-error', target: 'trajectory',
        match: event => failureRecord(event) ? { id: String(event.seq), role: 'start' } : null,
        start: (_context, match) => {
            const data = failureRecord(match.event);
            if (!data) throw new Error('Expected protocol failure plugin record');
            const { seq, time } = match.event;
            const label = t('protocol_error');
            return {
                kind: 'context', seq, time, form: 'notice',
                producer: { role: 'inject', label },
                source: { kind: 'exec/error', form: 'notice', summary: label },
                content: [{ type: 'text', text: `${data.failure!.code}\n\n${data.failure!.message}` }],
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
