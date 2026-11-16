import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { version } from './version.js';

/** @brief Describe runtime ownership before DSH removed it in 0.2.2-rc.2. */
interface OwnedAgents {
    /** @brief Check the registered child's exact runtime owner. */
    isOwnedBy(id: SessionId, owner: Agent): boolean;
}

/** @brief Resolve a live parent by session lineage on new hosts and runtime ownership on old hosts. */
export const parentAgent: (ctx: Context, agent: Agent) => Agent | undefined = version.gte('0.2.2-rc.2', () =>
    (ctx: Context, agent: Agent) => {
        const id = agent.session.header.parentSession;
        return id === undefined || id === agent.id ? undefined : ctx.agents.get(id);
    }) ?? ((ctx: Context, agent: Agent) => ctx.agents.list().find(candidate => candidate !== agent
        && (ctx.agents as unknown as OwnedAgents).isOwnedBy(agent.id, candidate)));
