import type { BuiltinTool } from '../runtime/builtins.js';

/** @brief Public callable contract shared by executable and management nodes. */
export interface CommandContract { tool: string; argMap?: Record<string, string>; schema: Record<string, unknown>; output: unknown; doc: string }

/** @brief Discriminator for executable namespace nodes. */
export type NodeType = 'command' | 'namespace' | 'inner_command' | 'inner_namespace' | 'root_namespace';

/** @brief Editing and pin choices owned by a node, independent of native execution guards. */
export interface NodePermissions {
    readonly rename: boolean;
    readonly move: boolean;
    readonly remove: boolean;
    readonly disable: boolean;
    readonly fixLevels: readonly (0 | 1 | 2)[];
}

/** @brief A transport-safe node snapshot without parent references. */
export interface SerializedNode {
    type: NodeType;
    name: string;
    permissions: NodePermissions;
    children?: SerializedNode[];
    command?: CommandContract;
    builtin?: BuiltinTool;
}

/** @brief Common structured identity and serialization contract for the namespace tree. */
export interface Node {
    readonly type: NodeType;
    readonly name: string;
    readonly parent: Node | undefined;
    readonly path: string;
    readonly permissions: NodePermissions;
    /** @brief Serialize a subtree without retaining parent references. */
    serialize(): SerializedNode;
}

/** @brief Share structural editing and pin permissions across host and browser nodes. */
export function nodePermissions(type: NodeType, path: string): NodePermissions {
    switch (type) {
        case 'root_namespace': return { rename: false, move: false, remove: false, disable: false, fixLevels: [] };
        case 'inner_namespace': return { rename: false, move: false, remove: false, disable: true, fixLevels: path === 'console' ? [0, 1] : [] };
        case 'inner_command': return { rename: false, move: false, remove: false, disable: path !== 'tools.intellisense', fixLevels: path === 'tools.intellisense' ? [2] : [0, 1, 2] };
        case 'namespace': return { rename: true, move: true, remove: true, disable: true, fixLevels: [0, 1] };
        case 'command': return { rename: true, move: true, remove: true, disable: true, fixLevels: [0, 1, 2] };
    }
}

/** @brief Resolve Profile pin preferences against the node's allowed choices. */
export function fixLevel(permissions: NodePermissions, level: 0 | 1 | 2 = 0): 0 | 1 | 2 {
    return permissions.fixLevels.includes(level) ? level : permissions.fixLevels[0] ?? 0;
}

/** @brief Cycle through exactly the fix levels offered by a node. */
export function nextFixLevel(permissions: NodePermissions, level: 0 | 1 | 2): 0 | 1 | 2 {
    const levels = permissions.fixLevels;
    return levels[(levels.indexOf(level) + 1) % levels.length] ?? 0;
}
