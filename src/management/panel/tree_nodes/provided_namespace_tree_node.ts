import { NamespaceTreeNode } from './namespace_tree_node.js';
import { ProvidedCommandTreeNode } from './provided_command_tree_node.js';
import type { ProvidedNamespace } from '../tree_provider.js';
import type { Permission } from '../../../namespace/node.js';

/** @brief A fixed runtime namespace owns builtin descendants and locked pin policy. */
export class ProvidedNamespaceTreeNode extends NamespaceTreeNode {

    constructor(private readonly contract: ProvidedNamespace, parent: NamespaceTreeNode) {
        super(contract.path.split('.').at(-1)!, parent);
        this.children.push(...contract.commands.map(command => new ProvidedCommandTreeNode(command, this)),
            ...(contract.children ?? []).map(namespace => new ProvidedNamespaceTreeNode(namespace, this)));
    }

    /** @brief Use the shared permission policy supplied for this builtin namespace. */
    override get permissions(): Permission { return this.contract.permissions; }

    /** @brief Use the builtin namespace documentation. */
    override get description(): string { return this.contract.description; }

    /** @brief Select the pin behavior from the shared builtin namespace permission policy. */
    override get pinMode(): 'locked' | 'provided' { return this.permissions.availableFixLevels.length ? 'provided' : 'locked'; }

    /** @brief Preserve the builtin namespace direct-member count. */
    override get count(): number { return this.children.length; }
}

