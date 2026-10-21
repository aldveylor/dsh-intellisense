import type { ToolCallId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session/types';
import type { CompletionResult } from '../typescript/completion.js';

/** @brief A replayable edit to unexecuted REPL source; it never dispatches a tool. */
export interface ReplSourceChange {
    turn: number;
    step: number;
    callId: ToolCallId;
    index: number;
    offset: number;
    text: string;
    interrupted?: true;
}

/** @brief Every lookup has a paired result, including cached replies and rejected repetition. */
export type IntellisenseRecord = { round: number; source: string } & (
    { phase: 'request' } | { phase: 'result'; result?: CompletionResult; error?: string; reused?: boolean }
);

declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'ts-repl/source': ReplSourceChange;
    }
}
