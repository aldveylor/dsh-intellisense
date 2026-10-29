import { nodePermissions, type Permission } from '../../namespace/node.js';
import type { ProfileTreeNode } from '../profile_node.js';

/** @brief Shared editable node state for trusted plugin-side Profile construction. */
export abstract class ProfileNode {
    protected settings: Pick<ProfileTreeNode, 'permissions' | 'disabled' | 'fixedLevel'> = {};

    constructor(readonly name = '') {}

    abstract readonly type: 'command' | 'namespace';

    get permissions(): Permission { return nodePermissions(this.type === 'command' ? 'leaf' : 'tree', structuredClone(this.settings.permissions)); }

    /** @brief Merge explicit permission overrides without changing unspecified fields. */
    setPermissions(value: Partial<Permission>): this {
        this.settings.permissions = { ...this.settings.permissions, ...structuredClone(value) };
        return this;
    }

    /** @brief Set this node's own disabled state. */
    setDisabled(value: boolean): this { this.settings.disabled = value; return this; }

    /** @brief Restore settings from transport data without retaining caller-owned objects. */
    protected restore(value: ProfileTreeNode): void {
        this.settings = structuredClone({ permissions: value.permissions, disabled: value.disabled, fixedLevel: value.fixedLevel });
    }

    /** @brief Serialize directly nested data, without parent references or flat paths. */
    abstract serialize(): ProfileTreeNode;

    /** @brief Keep JSON serialization identical to the recursive transport shape. */
    toJSON(): ProfileTreeNode { return this.serialize(); }
}
