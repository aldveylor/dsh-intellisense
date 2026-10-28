import { nodePermissions, type Node, type NodeType, type Permission, type SerializedNode } from '../../../namespace/node.js';
import type { NamespaceTreeNode } from './namespace_tree_node.js';
import type { CommandTreeNode } from './command_tree_node.js';

/** @brief Render tree nodes through their concrete command or namespace behavior. */
export interface TreeRenderer<T> {
    command(node: CommandTreeNode): T;
    namespace(node: NamespaceTreeNode): T;
}

/** @brief Browser node implements the same structural identity and policies as executable nodes. */
export abstract class TreeNode implements Node {
    abstract readonly type: NodeType;

    constructor(readonly name: string, readonly parent: NamespaceTreeNode | undefined = undefined) {}

    /** @brief Derive boundary paths from parent references instead of storing a second identity. */
    get path(): string { return this.parent?.path ? `${this.parent.path}.${this.name}` : this.name; }

    /** @brief Share permission choices with the integration node model. */
    get permissions(): Permission { return nodePermissions(this.type); }

    /** @brief Whether structural editing is prohibited for this node. */
    get fixed(): boolean { return !this.permissions.renamable && !this.permissions.movable && !this.permissions.removable; }

    /** @brief Serialize this node without retaining its parent reference. */
    abstract serialize(): SerializedNode;

    /** @brief Keep JSON serialization independent of cyclic parent references. */
    toJSON(): SerializedNode { return this.serialize(); }

    /** @brief Dispatch rendering to the concrete node implementation. */
    abstract render<T>(renderer: TreeRenderer<T>): T;
}

