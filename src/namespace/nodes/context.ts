import type { ToolAddition } from '../service.js';
import type { NamespaceTreeNode } from '../../registry/profile_node.js';
import type { ProfileNodeSettings } from '../../registry/profile/node_settings.js';
import type { PresentationMode } from '../../integration/presentation.js';
import type { NamespaceNode } from './node.js';
import type { CommandNode } from './command_node.js';
import type { Permission } from '../node.js';
import type { PhysicalTool } from '../../registry/registry.js';

/** @brief Scoped construction inputs; queries never synthesize or replace nodes. */
export interface NamespaceContext {
    implementation?: (path: string) => NamespaceImplementation | undefined;
    provided?: (path: string) => boolean;
    addition?: (tool: string) => ToolAddition;
    definitions?: NamespaceTreeNode;
    nodeSettings?: ProfileNodeSettings;
    mode?: PresentationMode;
    tools: readonly PhysicalTool[];
    disabled?: (path: string) => boolean;
    includeUnavailable?: boolean;
}


/** @brief Complete construction data for a provider-owned namespace implementation. */
export interface NamespaceInitialization {
    name: string;
    parent: NamespaceNode;
    description: string;
    permissions: Permission;
    disabled: boolean;
    fixedLevel: 0 | 1;
    children: (parent: NamespaceNode) => (NamespaceNode | CommandNode)[];
}

/** @brief Construct a namespace whose subclass owns its mutation policy. */
export type NamespaceImplementation = (options: NamespaceInitialization) => NamespaceNode;
