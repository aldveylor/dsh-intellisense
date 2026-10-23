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

declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:ts_intellisense/intellisense': SenseEvent;
    }
}
