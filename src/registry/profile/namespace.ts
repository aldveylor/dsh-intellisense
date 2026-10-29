import { EditableNode, type ProfileNode, type ProfileCheckContext } from './node.js';
import { EditableCommand, type ProfileCommand } from './command.js';
import { ProfilePermissionError } from '../../error.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../profile_node.js';

/** @brief Portable namespace contract containing directly nested node interfaces. */
export interface ProfileNamespace extends ProfileNode {
    readonly type: 'namespace';
    readonly children: ReadonlyMap<string, ProfileNode>;
    /** @brief Read one direct member, optionally requiring its node kind. */
    get(name: string): ProfileNode | undefined;
    get(name: string, kind: 'namespace'): ProfileNamespace | undefined;
    get(name: string, kind: 'command'): ProfileCommand | undefined;
    /** @brief Create a direct child; the default kind is namespace. */
    create(name: string, kind?: 'namespace'): ProfileNamespace;
    create(name: string, kind: 'command'): ProfileCommand;
    /** @brief Read or create a direct child of the specified kind. */
    getOrCreate(name: string, kind?: 'namespace'): ProfileNamespace;
    getOrCreate(name: string, kind: 'command'): ProfileCommand;
    /** @brief Remove one direct child in the editing copy. */
    remove(name: string): boolean;
    /** @brief Set the namespace description. */
    setDescription(value: string): this;
    /** @brief Set requested namespace visibility. */
    setFixedLevel(value: 0 | 1): this;
    serialize(): NamespaceTreeNode;
}

/** @brief Class implementation returning portable interfaces for all child operations. */
export class EditableNamespace extends EditableNode implements ProfileNamespace {
    readonly type = 'namespace';
    protected readonly members = new Map<string, ProfileNode>();
    protected description?: string;

    constructor(name = '', data?: NamespaceTreeNode) {
        super(name);
        if (data) {
            this.restore(data);
            this.description = data.description;
            for (const [name, child] of Object.entries(data.children ?? {})) {
                this.validateName(name);
                this.members.set(name, this.makeChild(name, child));
            }
        }
    }

    get children(): ReadonlyMap<string, ProfileNode> { return new Map(this.members); }

    /** @brief Hydration installs declared members without invoking external mutation methods. */
    protected makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        const path = this.memberName ? `${this.memberName}.${name}` : name;
        return data.type === 'namespace' ? new EditableNamespace(path, data) : new EditableCommand(path, data);
    }

    /** @brief Removing a namespace also asks every descendant whether it may be removed. */
    override assertRemovable(): void {
        super.assertRemovable();
        for (const child of this.members.values()) child.assertRemovable();
    }

    /** @brief Delegate validation to each concrete direct member without central builtin-name dispatch. */
    check(context: ProfileCheckContext, path = '', original: ProfileTreeNode | undefined = context.original): void {
        for (const [name, child] of this.members) child.check(context, path ? `${path}.${name}` : name, original?.children?.[name]);
    }

    /** @brief Apply local namespace settings and delegate each child patch to its own class. */
    apply(patch: Record<string, unknown>): this {
        if (patch.type !== undefined && patch.type !== 'namespace') throw new ProfilePermissionError(`Protected node cannot be replaced: ${this.memberName}`);
        if (Object.hasOwn(patch, 'description')) this.setDescription(patch.description === null ? undefined : patch.description as string);
        if (Object.hasOwn(patch, 'fixedLevel')) this.setFixedLevel((patch.fixedLevel ?? 0) as 0 | 1);
        if (Object.hasOwn(patch, 'disabled')) this.setDisabled(!!patch.disabled);
        if (patch.children && typeof patch.children === 'object') {
            for (const [name, value] of Object.entries(patch.children)) {
                const previous = this.get(name);
                if (value === null) { this.remove(name); continue; }
                const child = value as Record<string, unknown>;
                const replacing = previous && ((child.type !== undefined && child.type !== previous.type)
                    || (previous.type === 'command' && (child.command as { tool?: string } | undefined)?.tool !== undefined
                        && (child.command as { tool: string }).tool !== (previous as ProfileCommand).tool));
                if (replacing) this.remove(name);
                if (!previous || replacing) {
                    const created = child.type === 'command' ? this.create(name, 'command') : this.create(name);
                    created.apply(child);
                } else previous.apply(child);
            }
        }
        return this;
    }

    /** @brief Normalize existing children through their concrete node classes before comparison. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        if (value.type !== 'namespace') return super.normalize(value);
        const result = structuredClone(value);
        for (const [name, child] of this.members) {
            if (result.children?.[name]) result.children[name] = child.normalize(result.children[name]!);
        }
        return result;
    }

    /** @brief Read one direct member and reject kind mismatches. */
    get(name: string): ProfileNode | undefined;
    get(name: string, kind: 'namespace'): ProfileNamespace | undefined;
    get(name: string, kind: 'command'): ProfileCommand | undefined;
    get(name: string, kind?: 'namespace' | 'command'): ProfileNode | undefined {
        this.validateName(name);
        const node = this.members.get(name);
        if (node && kind && node.type !== kind) throw new Error(`Profile node type mismatch: ${name}`);
        return node;
    }

    /** @brief Create a new direct member without exposing implementation constructors. */
    create(name: string, kind?: 'namespace'): ProfileNamespace;
    create(name: string, kind: 'command'): ProfileCommand;
    create(name: string, kind: 'namespace' | 'command' = 'namespace'): ProfileNode {
        this.validateName(name);
        if (!this.permissions.acceptsChildren) throw new ProfilePermissionError(`Namespace does not accept children: ${this.memberName}`);
        if (this.members.has(name)) throw new Error(`Profile member already exists: ${name}`);
        const path = this.memberName ? `${this.memberName}.${name}` : name;
        const node = kind === 'namespace' ? new EditableNamespace(path) : new EditableCommand(path);
        this.members.set(name, node);
        return node;
    }

    /** @brief Read or create a matching direct member. */
    getOrCreate(name: string, kind?: 'namespace'): ProfileNamespace;
    getOrCreate(name: string, kind: 'command'): ProfileCommand;
    getOrCreate(name: string, kind: 'namespace' | 'command' = 'namespace'): ProfileNode {
        return kind === 'namespace' ? this.get(name, kind) ?? this.create(name, kind) : this.get(name, kind) ?? this.create(name, kind);
    }

    /** @brief Remove a direct member in this trusted editing copy. */
    remove(name: string): boolean { this.validateName(name); this.members.get(name)?.assertRemovable(); return this.members.delete(name); }

    /** @brief Set the namespace description. */
    setDescription(value: string | undefined): this { if (!this.permissions.commentable && value !== this.description) throw new ProfilePermissionError(`Node documentation cannot be changed: ${this.memberName}`); this.description = value; return this; }

    /** @brief Set whether this namespace is included in the prompt directory. */
    setFixedLevel(value: 0 | 1): this { if (this.permissions.availableFixLevels.length ? !this.permissions.availableFixLevels.includes(value) : value !== (this.settings.fixedLevel ?? 0)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${this.memberName}`); this.settings.fixedLevel = value; return this; }

    serialize(): NamespaceTreeNode {
        return structuredClone({ ...this.settings, type: this.type, fixedLevel: this.settings.fixedLevel as 0 | 1 | undefined,
            ...(this.description === undefined ? {} : { description: this.description }),
            children: Object.fromEntries([...this.members].map(([name, child]) => [name, child.serialize()])) });
    }

    /** @brief Accept direct member names only, excluding prototype and reserved object keys. */
    private validateName(name: string): void {
        if (!/^[A-Za-z_][\w$]*$/.test(name) || name.startsWith('__') || Object.hasOwn(Object.prototype, name) || ['prototype', 'then'].includes(name)) throw new Error(`Invalid Profile member name: ${name}`);
    }
}
