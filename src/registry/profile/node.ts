import { nodePermissions, type Permission } from '../../namespace/node.js';
import { ProfilePermissionError } from '../../error.js';
import type { ProfileTreeNode } from '../profile_node.js';

/** @brief Per-tree physical catalog information consumed by node implementations. */
export interface ProfileCheckContext {
    commands: ReadonlySet<string>;
    addition: (tool: string) => { fixed?: boolean; hidden?: boolean };
    original?: ProfileTreeNode;
}

/** @brief Portable node contract shared by namespace and command interfaces. */
export interface ProfileNode {
    readonly type: string;
    readonly permissions: Permission;
    /** @brief Merge explicit permission overrides. */
    setPermissions(value: Partial<Permission>): this;
    /** @brief Set this node's explicit disabled state. */
    setDisabled(value: boolean): this;
    /** @brief Check this node and its descendants against a physical catalog. */
    check(context: ProfileCheckContext, path?: string, original?: ProfileTreeNode): void;
    /** @brief Validate deletion or replacement of this node. */
    assertRemovable(): void;
    /** @brief Apply a node-local JSON patch through its concrete setters. */
    apply(patch: Record<string, unknown>): this;
    /** @brief Normalize a target node for differential saving. */
    normalize(value: ProfileTreeNode): ProfileTreeNode;
    /** @brief Export recursive transport data. */
    serialize(): ProfileTreeNode;
}

/** @brief Shared implementation for trusted plugin-side Profile node editing. */
export abstract class EditableNode implements ProfileNode {
    protected settings: Pick<ProfileTreeNode, 'permissions' | 'disabled' | 'fixedLevel'> = {};

    constructor(protected memberName = '') {}

    /** @brief Copy a concrete implementation without losing its prototype or provider-owned constructor state. */
    copyNode(value: ProfileTreeNode): this {
        const node = Object.assign(Object.create(Object.getPrototypeOf(this)), this) as this;
        node.restore({ ...value, permissions: { ...this.permissions, ...value.permissions } });
        return node;
    }

    /** @brief Bind diagnostic paths when a concrete node is installed under a new parent key. */
    bindName(path: string): void { this.memberName = path; }

    abstract readonly type: string;

    get permissions(): Permission { return nodePermissions(this.type === 'command' ? 'leaf' : 'tree', structuredClone(this.settings.permissions)); }

    /** @brief Merge explicit permission overrides without changing unspecified fields. */
    setPermissions(value: Partial<Permission>): this {
        this.settings.permissions = { ...this.settings.permissions, ...structuredClone(value) };
        return this;
    }

    /** @brief Check deletion using the node's own declared policy. */
    assertRemovable(): void {
        if (!this.permissions.removable) throw new ProfilePermissionError(`Node cannot be removed: ${this.memberName} (permissions.removable=false)`);
    }

    /** @brief Ordinary nodes preserve supplied values during differential saving. */
    normalize(value: ProfileTreeNode): ProfileTreeNode { return structuredClone(value); }

    /** @brief Concrete nodes own their final validation and descendant dispatch. */
    abstract check(context: ProfileCheckContext, path?: string, original?: ProfileTreeNode): void;

    /** @brief Concrete nodes apply their own writable fields. */
    abstract apply(patch: Record<string, unknown>): this;

    /** @brief Set this node's own disabled state. */
    setDisabled(value: boolean): this { if (value && !this.permissions.disableable) throw new ProfilePermissionError(`Node cannot be disabled: ${this.memberName}`); this.settings.disabled = value; return this; }

    /** @brief Restore settings from transport data without retaining caller-owned objects. */
    protected restore(value: ProfileTreeNode): void {
        this.settings = structuredClone({ permissions: value.permissions, disabled: value.disabled, fixedLevel: value.fixedLevel });
    }

    /** @brief Serialize directly nested data, without parent references or flat paths. */
    abstract serialize(): ProfileTreeNode;

    /** @brief Keep JSON serialization identical to the recursive transport shape. */
    toJSON(): ProfileTreeNode { return this.serialize(); }
}
