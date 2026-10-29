import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { z } from 'zod';
import type { ProfileSnapshot, ProfileCollection } from '../registry/profile/profile.js';
import type { SemanticRegistry } from '../registry/registry.js';
import type { CommandBrief, Profiles } from '../registry/profile_tree.js';
import type { SearchEngineRegistry } from '../search/engine_registry.js';
import type { NamespaceNode, CommandNode } from './namespace.js';
import type { CommandStatistics } from './statistics.js';

/** @brief Optional physical-tool attributes, independent of prompt pin levels. */
export interface ToolAddition {
    fixed?: boolean;
    /** @brief Hide from namespace discovery and tool mounting interfaces. */
    hidden?: boolean;
    /** @brief Override the tool description in PTC; native retains the physical description. */
    ptcDescription?: string;
}

/** @brief Portable namespace service with named snapshot editing and execution integration. */
export interface ToolsNamespace extends ProfileCollection {
    readonly searchEngines: SearchEngineRegistry;
    readonly statistics: CommandStatistics;

    /** @brief Register tool attributes until the returned disposer is called. */
    setToolAddition(tool: string, addition: ToolAddition): () => void;

    /** @brief Read an independent named or conversation snapshot. */
    get(name: string): Promise<ProfileSnapshot | undefined>;
    get(target: { agent: Agent }): Promise<ProfileSnapshot | undefined>;

    /** @brief Atomically publish the returned named or conversation snapshot. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;
    edit(target: { agent: Agent }, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;

    /** @brief Register physical namespace tools in a presentation scope. */
    register(ctx: Context): void;
    /** @brief Resolve whether a conversation has an Intellisense presentation. */
    enabled(agent: Agent): boolean;
    /** @brief Resolve whether a conversation uses PTC. */
    isPtc(agent: Agent): boolean;
    /** @brief Read the global or independent conversation registry. */
    registryFor(agent?: Agent): Promise<SemanticRegistry>;
    /** @brief Resolve the executable tree in the conversation's mode. */
    tree(agent: Agent, current?: SemanticRegistry): Promise<NamespaceNode>;
    /** @brief Read enabled command bindings at the execution boundary. */
    entries(agent: Agent, current?: SemanticRegistry): Promise<CommandNode[]>;
    /** @brief Read enabled preloaded values. */
    values(agent?: Agent, current?: SemanticRegistry): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>>;
    /** @brief Dispatch through the native guarded and audited tool pipeline. */
    dispatchTool(agent: Agent, tool: string, args: unknown, parent: ToolRunContext, sequence: number): Promise<unknown>;
    /** @brief Read catalog names and the conversation selection. */
    profileNames(agent?: Agent, current?: SemanticRegistry): Promise<Profiles>;
    /** @brief Read ordinary command summaries and usage counts. */
    commandBriefs(agent?: Agent, current?: SemanticRegistry): Promise<CommandBrief[]>;
}
