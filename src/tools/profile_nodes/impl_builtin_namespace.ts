import { EditableNamespace } from '../../registry/profile/namespace.js';
import type { ProfileNode } from '../../registry/profile/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../registry/profile_node.js';
import { nodePermissions, type Permission } from '../../namespace/node.js';
import { ProfilePermissionError } from '../../error.js';

/** @brief Common builtin namespace policy protects its declared direct children and documentation. */
export class ImplBuiltinNamespace extends EditableNamespace {
    /** @brief Hydration preserves the namespace documentation owned by its implementation. */
    override copyNode(value: ProfileTreeNode): this {
        if (value.type !== 'namespace') throw new ProfilePermissionError(`Protected node cannot be replaced: ${this.memberName}`);
        return super.copyNode({ ...value, description: this.description });
    }

    override get permissions(): Permission { return nodePermissions('tree', { renamable: false, movable: false, removable: false, commentable: false, acceptsChildren: false }); }

    /** @brief Builtin members are installed during construction; set rejects both insertion and replacement. */
    override set(_name: string, _node: ProfileNode): this { throw new ProfilePermissionError(`Namespace does not accept children: ${this.memberName}`); }

    /** @brief A builtin container does not permit direct member deletion. */
    override remove(name: string): boolean { throw new ProfilePermissionError(`Node cannot be removed: ${this.memberName}.${name} (permissions.removable=false)`); }

    /** @brief Permissions describe this implementation and cannot weaken its methods. */
    override setPermissions(_value: Partial<Permission>): this { throw new ProfilePermissionError(`Node permissions cannot be changed: ${this.memberName}`); }

    /** @brief Save restores required members while allowing each child to correct its own immutable values. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        if (value.type !== 'namespace') return this.serialize();
        const corrected: NamespaceTreeNode = { ...value, description: this.description, children: { ...value.children } };
        for (const [name, child] of this.children) corrected.children![name] = child.normalize(corrected.children![name] ?? child.serialize());
        return corrected;
    }

    override serialize(): NamespaceTreeNode { return { ...super.serialize(), permissions: this.permissions }; }
}
