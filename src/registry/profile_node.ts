import type { Permission } from '../namespace/node.js';

/** @brief Shared editable identity, permissions and visibility settings. */
export interface ProfileNode {
    type: string;
    name: string;
    permissions: Permission;
    fixedLevel?: number;
    disabled?: boolean;
}

/** @brief Physical command mounted at a named Profile member. */
export interface CommandNode extends ProfileNode {
    type: 'command';
    fixedLevel?: 0 | 1 | 2;
    command: { tool: string; argMap?: Record<string, string>; doc?: string };
    children?: never;
    description?: never;
}

/** @brief Namespace containing directly nested Profile members. */
export interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    fixedLevel?: 0 | 1;
    children?: ProfileTreeNode[];
    description?: string;
    command?: never;
}

/** @brief Editable command or namespace in a Profile. */
export type ProfileTreeNode = CommandNode | NamespaceTreeNode;
