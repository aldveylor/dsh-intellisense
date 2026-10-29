import type { z } from 'zod';
import type { SemanticRegistry } from '../registry/registry.js';
import type { CommandBrief, Profiles } from '../registry/profile_tree.js';
import type { CommandPresentation } from './node.js';
import type { PresentationMode } from '../integration/presentation.js';

/** @brief Optional physical-tool attributes, independent of prompt pin levels. */
export interface ToolAddition {
    fixed?: boolean;
    /** @brief Identify a command that discovers other namespace members. */
    discovery?: boolean;
    /** @brief Project provider-owned callable metadata without introducing a node subclass. */
    project?: (schema: Record<string, unknown>, mode: PresentationMode, discoveryAvailable: boolean) => CommandPresentation;
    /** @brief Produce a read-only PTC value; refresh policy applies after successful calls. */
    value?: { read: (source: { commandBriefs(current?: SemanticRegistry): Promise<CommandBrief[]>; profileNames(current?: SemanticRegistry): Promise<Profiles> }, registry: SemanticRegistry) => Promise<z.infer<ReturnType<typeof z.json>>>; refresh?: 'call' | 'revision' };
    /** @brief Hide from namespace discovery and tool mounting interfaces. */
    hidden?: boolean;
    /** @brief Override the tool description in PTC; native retains the physical description. */
    ptcDescription?: string;
}

