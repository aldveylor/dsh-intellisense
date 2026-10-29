import { FunctionTreeNode } from './function_tree_node.js';
import type { NamespaceTreeNode } from './namespace_tree_node.js';
import type { ProvidedFunction } from '../tree_provider.js';
import type { Permission, SerializedNode } from '../../../profile/namespace/node.js';

/** @brief A plugin function retains its contract and shared builtin permissions. */
export class ProvidedFunctionTreeNode extends FunctionTreeNode {

    constructor(private readonly contract: ProvidedFunction, parent: NamespaceTreeNode) { super(contract.path.split('.').at(-1)!, parent, undefined, contract.description); }

    /** @brief Expose the builtin function contract. */
    override get function(): ProvidedFunction { return this.contract; }

    /** @brief Use provider-supplied permission choices when a builtin customizes them. */
    override get permissions(): Permission { return this.contract.permissions; }

    override serialize(): SerializedNode { return { ...this.contract.node, permissions: this.permissions }; }
}

