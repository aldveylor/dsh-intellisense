import type { Counter } from '../statistics/statistics.js';
import type { ProfileReference } from '../registry/profile/snapshot_store.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';

/** @brief Session-owned Profile snapshot and call statistics, without command execution interfaces. */
export interface AgentSessionAddition {
    profile: ProfileReference;
    name: string;
    readonly statistics: Counter;
    /** @brief Append an immutable version and advance only this session reference after persistence. */
    save(snapshot?: ProfileSnapshot): Promise<void>;
}

/** @brief Expose optional IntelliSense state on the live session that owns it. */
declare module '@deepseek-ai/dsh-session' {
    interface Session {
        intellisense?: AgentSessionAddition;
    }
}
