import { NamespaceNode } from './node.js';
import type { CommandNode } from './command_node.js';
import type { Permission, SerializedNode } from '../node.js';

/** @brief Construct an owned subtree from portable definitions before exposing editing permissions. */
export class DefinedNamespaceNode extends NamespaceNode {
    constructor(name: string, parent: NamespaceNode, description: string, permissions: Permission, disabled: boolean, private readonly level: 0 | 1,
        children: (parent: NamespaceNode) => (NamespaceNode | CommandNode)[]) {
        super(name, parent, description, permissions, disabled);
        for (const child of children(this)) this.install(child);
    }

    override serialize(): SerializedNode { return { ...super.serialize(), fixedLevel: this.level }; }
}
