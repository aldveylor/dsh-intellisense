import type { Counter } from '../statistics/statistics.js';
import type { ProfileReference } from '../registry/profile/snapshot_store.js';

/** @brief Session-owned Profile snapshot and call statistics, without command execution interfaces. */
export interface AgentSessionAddition {
    readonly profile: ProfileReference;
    readonly name: string;
    readonly statistics: Counter;
    /** @brief Persist the current reference without modifying or publishing a Profile. */
    save(): Promise<void>;
}

/** @brief Expose optional IntelliSense state on the live session that owns it. */
declare module '@deepseek-ai/dsh-session' {
    interface Session {
        intellisense?: AgentSessionAddition;
    }
}
