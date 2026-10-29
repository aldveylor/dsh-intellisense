import type { TreeRenderer } from './tree_node.js';
import { TreeNode } from './tree_node.js';
import type { Namespace } from '../../../registry/registry.js';
import type { Permission, NodeType, SerializedNode } from '../../../namespace/node.js';

/** @brief An editable namespace owns ordered child references and counts descendant commands. */
export class NamespaceTreeNode extends TreeNode {
    readonly type: NodeType = 'tree';
    private readonly members: TreeNode[] = [];
    private cachedCount?: number;

    /** @brief Expose children without allowing mutations to bypass count invalidation. */
    get children(): readonly TreeNode[] { return this.members; }

    constructor(name: string, parent?: NamespaceTreeNode, readonly metadata?: Namespace, permissions?: Partial<Permission>) { super(name, parent, permissions); }

    /** @brief Append direct children and invalidate cached ancestor counts. */
    add(...nodes: TreeNode[]): void { this.members.push(...nodes); this.invalidateCount(); }

    /** @brief Sort direct children without changing their counts. */
    sort(compare: (left: TreeNode, right: TreeNode) => number): void { this.members.sort(compare); }

    /** @brief Clear derived counts whenever membership changes. */
    private invalidateCount(): void { this.cachedCount = undefined; this.parent?.invalidateCount(); }

    /** @brief Parent removal checks the child's server-supplied permission. */
    remove(name: string): boolean {
        const index = this.children.findIndex(node => node.name === name);
        if (index < 0) return false;
        if (!this.children[index]!.permissions.removable) throw new Error(`Node cannot be removed: ${this.children[index]!.path}`);
        this.members.splice(index, 1);
        this.invalidateCount();
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
    get count(): number { return this.cachedCount ??= this.children.reduce((count, child) => count + (child instanceof NamespaceTreeNode ? child.count : 1), 0); }

    serialize(): SerializedNode { return { type: this.type, name: this.name, permissions: this.permissions, children: this.children.map(node => node.serialize()) }; }

    /** @brief Render a namespace through the same interface as command leaves. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.namespace(this); }
}

