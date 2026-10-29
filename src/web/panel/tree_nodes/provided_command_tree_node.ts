import { CommandTreeNode } from './command_tree_node.js';
import type { NamespaceTreeNode } from './namespace_tree_node.js';
import type { ProvidedCommand } from '../tree_provider.js';
import type { Permission, SerializedNode } from '../../../profile/namespace/node.js';

/** @brief A plugin command retains its contract and shared builtin permissions. */
export class ProvidedCommandTreeNode extends CommandTreeNode {

    constructor(private readonly contract: ProvidedCommand, parent: NamespaceTreeNode) { super(contract.path.split('.').at(-1)!, parent, undefined, contract.description); }

    /** @brief Expose the builtin command contract. */
    override get command(): ProvidedCommand { return this.contract; }

    /** @brief Use provider-supplied permission choices when a builtin customizes them. */
    override get permissions(): Permission { return this.contract.permissions; }

    override serialize(): SerializedNode { return { ...this.contract.node, permissions: this.permissions }; }
}

