import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';

/** @brief Own REPL call records without settling the native assistant's ongoing reasoning stream. */
export const replTrajectory: ConversationNodeDefinitionInput<null> = {
    kind: 'ts-repl-execution',
    target: 'trajectory',
    match: {
        'assistant/message': event => {
            if (event.type !== 'assistant/message') return null;
            const execution = event.data.message.content.some(block => block.type === 'tool-call' && block.name === 'ts_repl' && String(block.id).startsWith('ts-repl-'));
            return execution ? { id: String(event.data.message.id), role: 'start', exclusive: true } : null;
        },
    },
    start: () => null,
    update: context => context.state,
    buildViewNode: context => {
        const start = context.start;
        const event = start?.event;
        if (!start || event?.type !== 'assistant/message') return null;
        const blocks = event.data.message.content.flatMap(block => block.type === 'tool-call' ? [{
            kind: 'tool-call' as const, callId: String(block.id), name: block.name, argsRaw: block.arguments,
        }] : []);
        return {
            key: context.key, kind: context.kind, id: context.id, target: 'trajectory',
            anchorSeq: event.seq, location: start.location,
            data: { kind: 'node', node: {
                kind: 'assistant', seq: event.seq, time: event.time,
                turn: event.data.turn, step: event.data.step, messageId: event.data.message.id, blocks,
            } },
        } satisfies TrajectoryConversationViewNode;
    },
};

/** @brief Install the projection for both live settlement and durable history replay. */
export function registerReplTrajectory(ctx: Context): void {
    ctx.inject(['uiConversation'], scope => {
        scope.uiConversation.events.register(replTrajectory);
    });
}
