import type { Context } from '@deepseek-ai/cordis';
import type { ConversationMatch, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import type {} from '../../protocol/execution_trace.js';

/** @brief Generated code is presentation state until its separate validated execution begins. */
interface ReplTrajectoryState { codes: string[]; interrupted: boolean }

/** @brief Own REPL call records without settling the native assistant's ongoing reasoning stream. */
export const replTrajectory: ConversationNodeDefinitionInput<ReplTrajectoryState> = {
    kind: 'ts-repl-execution',
    target: 'trajectory',
    match: {
        'ts-repl/source': event => event.type === 'ts-repl/source' ? {
            id: String(event.data.callId), role: event.data.offset === 0 ? 'start' : 'update', exclusive: true,
        } : null,
        'assistant/message': event => {
            if (event.type !== 'assistant/message') return null;
            const execution = event.data.message.content.find(block => block.type === 'tool-call' && block.name === 'ts_repl' && String(block.id).startsWith('ts-repl-'));
            return execution?.type === 'tool-call' ? { id: String(execution.id), role: 'start', exclusive: true } : null;
        },
    },
    start: (_context, match) => sourceState({ codes: [], interrupted: false }, match.event),
    update: (context, match) => sourceState(context.state, match.event),
    buildViewNode: context => {
        const start = context.start;
        const event = start?.event;
        if (!start || !context.state || (event?.type !== 'assistant/message' && event?.type !== 'ts-repl/source')) return null;
        const blocks = [{ kind: 'tool-call' as const, callId: context.id, name: 'ts_repl', argsRaw: JSON.stringify({ codes: context.state.codes }) }];
        return {
            key: context.key, kind: context.kind, id: context.id, target: 'trajectory',
            anchorSeq: event.seq, location: start.location,
            data: { kind: 'node', node: {
                kind: 'assistant', seq: event.seq, time: event.time,
                turn: event.data.turn, step: event.data.step, blocks,
                ...(context.state.interrupted ? { interrupted: true } : {}),
            } },
        } satisfies TrajectoryConversationViewNode;
    },
};

/** @brief Apply the same code edits during live delivery and durable history replay. */
function sourceState(state: ReplTrajectoryState, event: ConversationMatch['event']): ReplTrajectoryState {
    if (event.type === 'ts-repl/source') {
        const codes = [...state.codes];
        codes[event.data.index] = (codes[event.data.index] ?? '').slice(0, event.data.offset) + event.data.text;
        return { codes, interrupted: event.data.interrupted === true };
    }
    if (event.type === 'assistant/message') {
        const execution = event.data.message.content.find(block => block.type === 'tool-call' && block.name === 'ts_repl');
        if (execution?.type === 'tool-call') return { codes: JSON.parse(execution.arguments).codes, interrupted: false };
    }
    return state;
}

/** @brief Install the projection for both live settlement and durable history replay. */
export function registerReplTrajectory(ctx: Context): void {
    ctx.inject(['uiConversation'], scope => {
        scope.uiConversation.events.register(replTrajectory);
    });
}
