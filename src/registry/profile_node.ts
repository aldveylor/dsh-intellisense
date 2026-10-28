import type { Permission } from '../namespace/node.js';

/** @brief Shared editable type, permissions and visibility settings. */
export interface ProfileNode {
    type: string;
    /** @brief Constraints on members retained and edited in the saved Profile, including original names and paths of protected members; these do not permit runtime namespace mutation. Optional overrides of ordinary node permissions; server-owned restrictions remain authoritative. */
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

/** @brief Namespace containing directly nested Profile members keyed by name. */
export interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    fixedLevel?: 0 | 1;
    children?: Record<string, CommandNode | NamespaceTreeNode>;
    description?: string;
    command?: never;
}

/** @brief Editable command or namespace in a Profile. */
export type ProfileTreeNode = CommandNode | NamespaceTreeNode;
