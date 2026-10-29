import type { ProfileSnapshot } from '../registry/profile/profile.js';

/** @brief Agent-owned Profile snapshot and call statistics, without command execution interfaces. */
export interface AgentSessionAddition {
    profile: ProfileSnapshot;
    readonly statistics: {
        /** @brief Record one attempted physical tool call for this session. */
        recordCall(tool: string): Promise<void>;
    };
}
