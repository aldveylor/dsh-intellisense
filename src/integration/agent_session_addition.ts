import type { Counter } from '../statistics/statistics.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';

/** @brief Session-owned Profile snapshot and call statistics, without command execution interfaces. */
export interface AgentSessionAddition {
    profile: ProfileSnapshot;
    readonly statistics: Counter;
    /** @brief Persist the current Profile, including direct snapshot edits. */
    save(): Promise<void>;
}

/** @brief Expose optional IntelliSense state on the live session that owns it. */
declare module '@deepseek-ai/dsh-session' {
    interface Session {
        intellisense?: AgentSessionAddition;
    }
}
