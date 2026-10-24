import '@deepseek-ai/dsh-session';

/** @brief A loop-owned position passed explicitly into a request-local adapter. */
export interface Position { turn: number; step: number }

/** @brief Batched discovery arguments and the complete declaration result. */
export interface SenseEvent extends Position {
    queries: string[];
    info: string;
    elapsedMs: number;
    profileRevision?: number;
    runtimeEpoch?: number;
}

/** @brief Replayable builtin contract, arguments and output for trajectory inspection. */
export interface BuiltinEvent {
    name: string;
    callId: string;
    schema: string;
    arguments: string;
    result: string;
    language: 'typescript' | 'json' | 'text';
    elapsedMs: number;
    isError: boolean;
}

declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:ts_intellisense/intellisense': SenseEvent;
        'plugin:ts_intellisense/builtin': BuiltinEvent;
    }
}
