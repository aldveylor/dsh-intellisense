import type { TreeRenderer } from './tree_node.js';
import { TreeNode } from './tree_node.js';
import type { Namespace } from '../../../registry/registry.js';
import type { NodeType, SerializedNode } from '../../../namespace/node.js';

/** @brief An editable namespace owns ordered child references and counts descendant commands. */
export class NamespaceTreeNode extends TreeNode {
    readonly type: NodeType = 'tree';
    readonly children: TreeNode[] = [];

    constructor(name: string, parent?: NamespaceTreeNode, readonly metadata?: Namespace) { super(name, parent); }

    /** @brief Parent removal checks the child's server-supplied permission. */
    remove(name: string): boolean {
        const index = this.children.findIndex(node => node.name === name);
        if (index < 0) return false;
        if (!this.children[index]!.permissions.removable) throw new Error(`Node cannot be removed: ${this.children[index]!.path}`);
        this.children.splice(index, 1);
        return true;
    }

    /** @brief Follow direct child references from this namespace. */
    resolve(parts: readonly string[]): TreeNode | undefined {
        const [name, ...remaining] = parts;
        if (name === undefined) return this;
        const child = this.children.find(node => node.name === name);
        return remaining.length ? child instanceof NamespaceTreeNode ? child.resolve(remaining) : undefined : child;
    }

    /** @brief Namespace documentation displayed by the editor. */
    get description(): string { return this.metadata?.description ?? ''; }

    /** @brief Select namespace pin behavior. */
    get pinMode(): 'profile' | 'locked' | 'provided' { return 'profile'; }

    /** @brief Number of commands represented by this namespace. */
    get count(): number { return this.children.reduce((count, child) => count + (child instanceof NamespaceTreeNode ? child.count : 1), 0); }

    serialize(): SerializedNode { return { type: this.type, name: this.name, permissions: this.permissions, children: this.children.map(node => node.serialize()) }; }

    /** @brief Render a namespace through the same interface as command leaves. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.namespace(this); }
}

