import type { ToolCallId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session/types';

/** @brief A replayable edit to unexecuted REPL source; it never dispatches a tool. */
export interface ReplSourceChange {
    turn: number;
    step: number;
    callId: ToolCallId;
    offset: number;
    text: string;
    interrupted?: true;
}

declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'ts-repl/source': ReplSourceChange;
    }
}
