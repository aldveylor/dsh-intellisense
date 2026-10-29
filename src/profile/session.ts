import type { Session } from '@deepseek-ai/dsh-session';
import type { AgentSessionAddition } from '../integration/agent_session_addition.js';
import type { CommandStatistics } from '../statistics/command_statistics.js';
import type { Statistics } from '../statistics/statistics.js';

/** @brief Session reference operations consumed independently of their storage implementation. */
export interface ProfileSessionCollection {
    readonly statistics: CommandStatistics;
    readonly inspectStatistics: Statistics;
    /** @brief Restore or initialize one session, optionally inheriting a parent or selecting a locked Profile. */
    addition(session: Session, inherit?: () => Promise<AgentSessionAddition | undefined>, profile?: string): Promise<AgentSessionAddition>;
    /** @brief Read or initialize a session-owned reference. */
    forSession(session: Session, inherit?: () => Promise<AgentSessionAddition | undefined>, profile?: string): Promise<AgentSessionAddition>;
    /** @brief Select the current named version while retaining all older session versions. */
    load(session: Session, name: string): Promise<AgentSessionAddition>;
}
