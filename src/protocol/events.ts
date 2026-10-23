import '@deepseek-ai/dsh-session';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';

/** @brief A loop-owned position passed explicitly into a request-local adapter. */
export interface Position { turn: number; step: number }

/** @brief All nondeterministic completion data needed to reconstruct a continuation request. */
export interface SenseEvent extends Position {
    marker: string;
    segment: number;
    sessionId: GenerateOptions['sessionId'];
    prefix: string;
    context: string;
    info: string;
    injected: string;
    elapsedMs: number;
    discardedPrefixLength: number;
}

/** @brief Original response segments and every discard decision accompanying source extraction. */
export interface RewriteEvent extends Position {
    original: string[];
    code: string;
    hash: string;
    discardedTail: string;
    discardedBlocks: string[];
    reason: 'exec' | 'prose' | 'abandoned' | 'error';
}

/** @brief Durable custom events emitted through a session-owned writer. */
export interface AuditEvents { 'exec/intellisense': SenseEvent; 'exec/rewrite': RewriteEvent }

declare module '@deepseek-ai/dsh-session' {
    interface SessionEventMap extends AuditEvents {
        /** @brief Exact state-dependent system instructions used to reconstruct the provider request. */
        'exec/context': Position & { instructions: string; provider: string; model: string; epoch: number };
    }
}

declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** @brief Deterministic user-role projection of a logged program result. */
        'exec-result': { kind: 'exec-result'; form: 'notice'; summary: string };
    }
}
