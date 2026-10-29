import type { z } from 'zod';
import type { ProfileCollection } from '../registry/profile/profile.js';
import type { SemanticRegistry } from '../registry/registry.js';
import type { CommandBrief, Profiles } from '../registry/profile_tree.js';
import type { SearchEngineRegistry } from '../search/engine_registry.js';
import type { NamespaceImplementation } from './nodes/context.js';
import type { CommandPresentation } from './node.js';
import type { PresentationMode } from '../integration/presentation.js';
import type { CommandStatistics } from './statistics.js';

/** @brief Optional physical-tool attributes, independent of prompt pin levels. */
export interface ToolAddition {
    fixed?: boolean;
    /** @brief Identify a command that discovers other namespace members. */
    discovery?: boolean;
    /** @brief Project provider-owned callable metadata without introducing a node subclass. */
    project?: (schema: Record<string, unknown>, mode: PresentationMode, discoveryAvailable: boolean) => CommandPresentation;
    /** @brief Produce a read-only PTC value; refresh policy applies after successful calls. */
    value?: { read: (service: ToolsNamespace, registry: SemanticRegistry) => Promise<z.infer<ReturnType<typeof z.json>>>; refresh?: 'call' | 'revision' };
    /** @brief Hide from namespace discovery and tool mounting interfaces. */
    hidden?: boolean;
    /** @brief Override the tool description in PTC; native retains the physical description. */
    ptcDescription?: string;
}

/** @brief Basic saved-Profile event; specialized event descriptions may extend this interface. */
export interface ProfileSaveEvent {
    readonly name: string;
    /** @brief ISO 8601 UTC time recorded after successful persistence. */
    readonly time: string;
    readonly type: string;
}

/** @brief Observe a completed save without producing tool feedback. */
export type ProfileSaveEffect = (event: ProfileSaveEvent) => void | Promise<void>;

/** @brief Portable namespace service with named snapshot editing and command-name resolution. */
export interface ToolsNamespace extends ProfileCollection {
    /** @brief Register ordered, disposable events emitted only after save or apply has persisted successfully. */
    effect(event: 'save', handler: ProfileSaveEffect): () => void;
    readonly searchEngines: SearchEngineRegistry;
    readonly statistics: CommandStatistics;

    /** @brief Register a namespace implementation whose methods own mutation restrictions. */
    setNamespaceImplementation(path: string, implementation: NamespaceImplementation): () => void;

    /** @brief Register tool attributes until the returned disposer is called. */
    setToolAddition(tool: string, addition: ToolAddition): () => void;

    /** @brief Resolve an enabled command path to its physical tool name without execution. */
    resolve(path: string, profile?: string): Promise<string | undefined>;
    /** @brief Read catalog names with a Profile selection. */
    profileNames(current?: SemanticRegistry): Promise<Profiles>;
    /** @brief Read ordinary command summaries and usage counts. */
    commandBriefs(current?: SemanticRegistry): Promise<CommandBrief[]>;
}
