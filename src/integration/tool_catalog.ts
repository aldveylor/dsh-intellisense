import type { PhysicalTool } from '../profile/catalog/registry.js';
import type { ToolAdditions } from './tool_additions/tool_additions.js';

/** @brief Physical tool metadata consumed by execution integration independently of Profile storage. */
export interface ToolCatalog {
    readonly toolAdditions: ToolAdditions;
    /** @brief Replace the physical catalog from the currently available scopes. */
    refresh(tools: PhysicalTool[]): void;
    /** @brief Read detached physical tool metadata. */
    tools(): PhysicalTool[];
}
