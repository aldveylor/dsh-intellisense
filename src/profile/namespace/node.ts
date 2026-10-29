/** @brief Optional callable projection registered by a physical-tool provider. */
export interface CommandPresentation {
    signature: string;
    description: string;
    parameterDocs?: Readonly<Record<string, string>>;
    positional?: readonly (readonly string[])[];
    overloads?: readonly string[];
    discardResult?: boolean;
    preload?: boolean;
}

/** @brief Public callable contract shared by executable and management nodes. */
export interface CommandContract { tool: string; schema: Record<string, unknown>; output?: unknown; doc: string; presentation?: CommandPresentation }

/** @brief Discriminator for executable namespace nodes. */
export type NodeType = 'leaf' | 'tree';

/** @brief Editing and pin choices owned by a node, independent of native execution guards.
 * Ordinary nodes default to true for renamable/commentable/movable/removable/disableable.
 * acceptsChildren defaults to true for trees and false for leaves; availableFixLevels defaults to [0, 1] for trees and [0, 1, 2] for leaves.
 */
export interface Permission {
    readonly renamable: boolean;
    readonly commentable: boolean;
    readonly movable: boolean;
    readonly removable: boolean;
    readonly disableable: boolean;
    readonly acceptsChildren: boolean;
    readonly availableFixLevels: readonly (0 | 1 | 2)[];
}

/** @brief A transport-safe node snapshot without parent references. */
export interface SerializedNode {
    type: NodeType;
    name: string;
    permissions: Permission;
    children?: SerializedNode[];
    command?: CommandContract;
    description?: string;
    preload?: boolean;
    fixedLevel?: 0 | 1 | 2;
    disabled?: boolean;
}

/** @brief Common structured identity and serialization contract for the namespace tree. */
export interface Node {
    readonly type: NodeType;
    readonly name: string;
    readonly parent: Node | undefined;
    readonly path: string;
    readonly permissions: Permission;
    /** @brief Serialize a subtree without retaining parent references. */
    serialize(): SerializedNode;
}

/** @brief Share structural editing and pin permissions across host and browser nodes. */
export function nodePermissions(type: NodeType, overrides: Partial<Permission> = {}): Permission {
    return { renamable: true, commentable: true, movable: true, removable: true, disableable: true, acceptsChildren: type === 'tree',
        availableFixLevels: type === 'leaf' ? [0, 1, 2] : [0, 1], ...overrides };
}

/** @brief Resolve Profile pin preferences against the node's allowed choices. */
export function fixLevel(permissions: Permission, level: 0 | 1 | 2 = 0): 0 | 1 | 2 {
    return permissions.availableFixLevels.includes(level) ? level : permissions.availableFixLevels[0] ?? 0;
}

/** @brief Cycle through exactly the fix levels offered by a node. */
export function nextFixLevel(permissions: Permission, level: 0 | 1 | 2): 0 | 1 | 2 {
    const levels = permissions.availableFixLevels;
    return levels[(levels.indexOf(level) + 1) % levels.length] ?? 0;
}

/** @brief Validate structural identifiers without knowing any server-owned namespace names. */
export function validateNodePath(path: string): void {
    if (!path || path.split('.').some(part => !/^[A-Za-z_$][\w$]*$/.test(part) || ['__proto__', 'constructor', 'prototype', 'then'].includes(part) || part.startsWith('__dsh'))) throw new Error('invalid_namespace_path');
}
