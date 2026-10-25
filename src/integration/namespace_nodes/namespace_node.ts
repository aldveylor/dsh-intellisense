import { nodePermissions, type Permission, type Node, type NodeType, type SerializedNode } from '../node.js';
import type { CommandNode } from './command_node.js';

/** @brief An ordinary namespace owns direct child references and enforces child permissions. */
export class NamespaceNode implements Node {
    readonly type: NodeType = 'tree';
    private readonly members = new Map<string, NamespaceNode | CommandNode>();

    constructor(readonly name: string, readonly parent: NamespaceNode | undefined = undefined, readonly description = '', readonly permissions: Permission = nodePermissions('tree'), private readonly disabledState = false) {}

    get path(): string { return this.parent?.path ? `${this.parent.path}.${this.name}` : this.name; }

    get disabled(): boolean { return this.disabledState || (this.parent?.disabled ?? false); }

    get children(): ReadonlyMap<string, NamespaceNode | CommandNode> { return this.members; }

    /** @brief Install an owned child once; existing mappings are never overwritten. */
    protected install<T extends NamespaceNode | CommandNode>(node: T): T {
        if (node.parent !== this || !/^[A-Za-z_$][\w$]*$/.test(node.name) || ['__proto__', 'constructor', 'prototype', 'then'].includes(node.name)) throw new Error(`Invalid namespace child: ${node.name}`);
        if (this.members.has(node.name)) throw new Error(`Namespace overlaps an existing node: ${node.path}`);
        this.members.set(node.name, node);
        return node;
    }

    /** @brief External insertion is governed by the namespace's own policy. */
    add<T extends NamespaceNode | CommandNode>(node: T): T {
        if (!this.permissions.acceptsChildren) throw new Error(`Namespace does not accept children: ${this.path}`);
        return this.install(node);
    }

    /** @brief A parent must honor its child's removal permission. */
    remove(name: string): boolean {
        const child = this.members.get(name);
        if (child && !child.permissions.removable) throw new Error(`Node cannot be removed: ${child.path}`);
        return this.members.delete(name);
    }

    /** @brief Follow direct child references from this namespace. */
    resolve(parts: readonly string[]): NamespaceNode | CommandNode | undefined {
        const [name, ...remaining] = parts;
        if (name === undefined) return this;
        const child = this.children.get(name);
        return remaining.length ? child instanceof NamespaceNode ? child.resolve(remaining) : undefined : child;
    }

    /** @brief Project command leaves only at deployment and presentation boundaries. */
    commands(): CommandNode[] { return [...this.children.values()].flatMap(node => node instanceof NamespaceNode ? node.commands() : [node]); }

    serialize(): SerializedNode { return { type: this.type, name: this.name, description: this.description, disabled: this.disabled, permissions: this.permissions, children: [...this.children.values()].map(node => node.serialize()) }; }

    /** @brief Avoid cyclic parent references in JSON consumers. */
    toJSON(): SerializedNode { return this.serialize(); }
}

