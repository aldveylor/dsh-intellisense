import { nodePermissions, type Permission } from '../../namespace/node.js';
import type { ProfileTreeNode } from '../profile_node.js';

/** @brief Portable node contract shared by namespace and command interfaces. */
export interface ProfileNode {
    readonly type: 'command' | 'namespace';
    readonly permissions: Permission;
    /** @brief Merge explicit permission overrides. */
    setPermissions(value: Partial<Permission>): this;
    /** @brief Set this node's explicit disabled state. */
    setDisabled(value: boolean): this;
    /** @brief Export recursive transport data. */
    serialize(): ProfileTreeNode;
}

/** @brief Shared implementation for trusted plugin-side Profile node editing. */
export abstract class EditableNode implements ProfileNode {
    protected settings: Pick<ProfileTreeNode, 'permissions' | 'disabled' | 'fixedLevel'> = {};

    constructor(protected readonly memberName = '') {}

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
