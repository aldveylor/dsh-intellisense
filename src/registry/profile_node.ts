import type { Permission } from '../namespace/node.js';

/** @brief Shared editable identity, permissions and visibility settings. */
export interface ProfileNode {
    type: string;
    name: string;
    /** @brief Optional overrides of ordinary node permissions; server-owned restrictions remain authoritative. */
    permissions?: Partial<Permission>;
    /** @brief Pin level, default 0; omitted when default. */
    fixedLevel?: number;
    /** @brief Disable this node and its subtree, default false; omitted when default. */
    disabled?: boolean;
}

/** @brief Physical command mounted at a named Profile member. */
export interface CommandNode extends ProfileNode {
    type: 'command';
    fixedLevel?: 0 | 1 | 2;
    command: {
        tool: string;
        /** @brief One-sentence summary of the command functionality; cannot modify the original command documentation or schema. */
        doc?: string;
    };
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
