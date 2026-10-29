import type { ToolAddition } from '../service.js';
import type { NamespaceTreeNode } from '../../registry/profile_node.js';
import type { ProfileNodeSettings } from '../../registry/profile/node_settings.js';
import type { PresentationMode } from '../../integration/presentation.js';
import type { PhysicalTool } from '../../registry/registry.js';

/** @brief Scoped construction inputs; queries never synthesize or replace nodes. */
export interface NamespaceContext {
    provided?: (path: string) => boolean;
    addition?: (tool: string) => ToolAddition;
    definitions?: NamespaceTreeNode;
    nodeSettings?: ProfileNodeSettings;
    mode?: PresentationMode;
    tools: readonly PhysicalTool[];
    disabled?: (path: string) => boolean;
    includeUnavailable?: boolean;
}

