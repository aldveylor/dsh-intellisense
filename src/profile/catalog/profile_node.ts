import type { Permission } from '../namespace/node.js';

/** @brief Shared node type, read-only server permissions and editable visibility settings. */
export interface ProfileNode {
    type: string;
    /** @brief Constraints on members retained and edited in the saved Profile, including original names and paths of protected members; these do not permit runtime namespace mutation. Read-only server rules returned by load; save/apply reject permissions at every depth. */
    permissions?: Partial<Permission>;
    /** @brief Pin level, default 0; omitted when default. */
    fixedLevel?: number;
    /** @brief Disable this node and its subtree, default false; omitted when default. */
    disabled?: boolean;
}

/** @brief Physical tool mounted as a function at a named Profile member. */
export interface FunctionNode extends ProfileNode {
    type: 'function';
    fixedLevel?: 0 | 1 | 2;
    function: {
        tool: string;
        /** @brief Optional one-sentence summary, absent by default; empty or whitespace-only text means absent; cannot modify the original tool documentation or schema. */
        doc?: string;
    };
    children?: never;
    description?: never;
}

/** @brief Namespace containing directly nested Profile members keyed by name. */
export interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    fixedLevel?: 0 | 1;
    children?: Record<string, FunctionNode | NamespaceTreeNode>;
    description?: string;
    function?: never;
}

/** @brief Editable function or namespace in a Profile. */
export type ProfileTreeNode = FunctionNode | NamespaceTreeNode;
