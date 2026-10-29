import type { ProfileSnapshot, ProfileCollection } from '../registry/profile/profile.js';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NamespaceComponent } from './component.js';

/** @brief Optional physical-tool attributes, independent of prompt pin levels. */
export interface ToolAddition {
    fixed?: boolean;
    /** @brief Hide from namespace discovery and tool mounting interfaces. */
    hidden?: boolean;
    /** @brief Override the tool description in PTC; native retains the physical description. */
    ptcDescription?: string;
}

/** @brief Portable namespace service, including the existing execution integration methods. */
export interface ToolsNamespace extends ProfileCollection, Pick<NamespaceComponent,
    'register' | 'enabled' | 'isPtc' | 'registryFor' | 'tree' | 'entries' | 'values' | 'dispatchTool' |
    'profileNames' | 'commandBriefs' | 'statistics' | 'searchEngines'> {
    /** @brief Register tool attributes until the returned disposer is called. */
    setToolAddition(tool: string, addition: ToolAddition): () => void;
    /** @brief Read an independent snapshot from a conversation working configuration. */
    get(name: string): Promise<ProfileSnapshot | undefined>;
    get(target: { agent: Agent }): Promise<ProfileSnapshot | undefined>;
    /** @brief Modify a named or conversation snapshot and publish the returned tree atomically. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;
    edit(target: { agent: Agent }, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;
}
