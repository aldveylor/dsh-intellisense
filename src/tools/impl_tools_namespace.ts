import { ProfilePermissionError } from '../error.js';
import { DefinedNamespaceNode } from '../namespace/nodes/defined_namespace_node.js';
import type { NamespaceInitialization } from '../namespace/nodes/context.js';
import type { NamespaceNode } from '../namespace/nodes/node.js';
import type { CommandNode } from '../namespace/nodes/command_node.js';
import type { NamespaceTreeNode } from '../registry/profile_node.js';
import { validateProfileEdit } from '../registry/profile/validate_edit.js';

/** @brief Plugin-owned tools containers enforce their structure independently of permission declarations. */
export class ImplToolsNamespace extends DefinedNamespaceNode {
    constructor(options: NamespaceInitialization) {
        super(options.name, options.parent, options.description, options.permissions, options.disabled, options.fixedLevel, options.children);
    }

    /** @brief Expose a detached member map so consumers cannot mutate owned children through it. */
    override get children(): ReadonlyMap<string, NamespaceNode | CommandNode> { return new Map(super.children); }

    /** @brief Only construction installs members of a plugin-owned tools container. */
    override add<T extends NamespaceNode | CommandNode>(_node: T): T { throw new ProfilePermissionError(`Namespace does not accept children: ${this.path}`); }

    /** @brief Tools members cannot be removed through the runtime node interface. */
    override remove(_name: string): boolean { throw new ProfilePermissionError(`Namespace members cannot be removed: ${this.path}`); }

    /** @brief The provider's save effect validates detached JSON writes after restoring its required values. */
    static validateSave(before: NamespaceTreeNode, after: NamespaceTreeNode): void {
        const original = before.children?.tools;
        const submitted = after.children?.tools;
        if (original?.type === 'namespace' && submitted?.type === 'namespace') validateProfileEdit(original, submitted, 'tools');
    }
}
