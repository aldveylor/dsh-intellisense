import { EditableNode, type ProfileNode, type ProfileCheckContext } from './node.js';
import { EditableCommand, type ProfileCommand } from './command.js';
import { ProfilePermissionError } from '../error.js';
import type { NamespaceTreeNode, ProfileTreeNode } from './catalog/profile_node.js';

/** @brief Portable namespace contract containing directly nested node interfaces. */
export interface ProfileNamespace extends ProfileNode {
    readonly type: 'namespace';
    readonly description: string | undefined;
    readonly children: ReadonlyMap<string, ProfileNode>;
    /** @brief Read one direct member; inspect type before casting to a specialized interface. */
    get(name: string): ProfileNode | undefined;
    /** @brief Install a supplied node through this namespace's mutation policy. */
    set(name: string, node: ProfileNode): this;
    /** @brief Construct a fresh node and install it through set. */
    create<T extends ProfileNode>(name: string, factory: () => T): T;
    /** @brief Read a direct node or construct a matching one through create and set. */
    getOrCreate<T extends ProfileNode>(name: string, factory: () => T): T;
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
    protected members = new Map<string, ProfileNode>();
    protected namespaceDescription?: string;

    constructor(name = '', data?: NamespaceTreeNode) {
        super(name);
        if (data) {
            this.restore(data);
            this.namespaceDescription = data.description;
            for (const [name, child] of Object.entries(data.children ?? {})) {
                this.validateName(name);
                const node = this.makeChild(name, child);
                node.bindName(this.memberName ? `${this.memberName}.${name}` : name);
                this.members.set(name, node);
            }
        }
    }

    get description(): string | undefined { return this.namespaceDescription; }

    get children(): ReadonlyMap<string, ProfileNode> { return new Map(this.members); }

    /** @brief Restore data recursively using the actual node prototypes declared by the initial factory. */
    override copyNode(value: ProfileTreeNode): this {
        if (value.type !== 'namespace') throw new ProfilePermissionError(`Protected node cannot be replaced: ${this.memberName}`);
        const node = super.copyNode(value);
        node.members = new Map();
        node.namespaceDescription = value.description;
        for (const [name, data] of Object.entries(value.children ?? {})) {
            this.validateName(name);
            const original = this.members.get(name);
            const child = original && original.type === data.type ? original.copyNode(data) : this.makeChild(name, data);
            child.bindName(this.memberName ? `${this.memberName}.${name}` : name);
            node.members.set(name, child);
        }
        for (const [name, child] of this.members) {
            if (!node.members.has(name) && !child.permissions.removable) node.members.set(name, child.copyNode(child.serialize()));
        }
        return node;
    }

    /** @brief Diagnostic paths follow a node when it is installed under a different parent key. */
    override bindName(path: string): void {
        super.bindName(path);
        for (const [name, child] of this.members) child.bindName(path ? `${path}.${name}` : name);
    }

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
                    const created = child.type === 'command' ? this.create(name, () => new EditableCommand(name)) : this.create(name, () => new EditableNamespace(name));
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

    /** @brief Read a direct member without inferring a subtype from caller arguments. */
    get(name: string): ProfileNode | undefined { this.validateName(name); return this.members.get(name); }

    /** @brief Direct insertion and replacement share one overridable mutation boundary. */
    set(name: string, node: ProfileNode): this {
        this.validateName(name);
        if (!this.permissions.acceptsChildren) throw new ProfilePermissionError(`Namespace does not accept children: ${this.memberName}`);
        const previous = this.members.get(name);
        if (previous !== node) previous?.assertRemovable();
        node.bindName(this.memberName ? `${this.memberName}.${name}` : name);
        this.members.set(name, node);
        return this;
    }

    /** @brief Construct the factory's exact node type and install it through the shared set boundary. */
    create<T extends ProfileNode>(name: string, factory: () => T): T {
        this.validateName(name);
        if (this.members.has(name)) throw new Error(`Profile member already exists: ${name}`);
        const node = factory();
        this.set(name, node);
        return node;
    }

    /** @brief Existing keys retain their node identity; the caller's factory supplies the concrete return type. */
    getOrCreate<T extends ProfileNode>(name: string, factory: () => T): T {
        const node = this.get(name);
        return node ? node as T : this.create(name, factory);
    }

    /** @brief Remove a direct member in this trusted editing copy. */
    remove(name: string): boolean { this.validateName(name); this.members.get(name)?.assertRemovable(); return this.members.delete(name); }

    /** @brief Set the namespace description. */
    setDescription(value: string | undefined): this { if (!this.permissions.commentable && value !== this.namespaceDescription) throw new ProfilePermissionError(`Node documentation cannot be changed: ${this.memberName}`); this.namespaceDescription = value; return this; }

    /** @brief Set whether this namespace is included in the prompt directory. */
    setFixedLevel(value: 0 | 1): this { if (this.permissions.availableFixLevels.length ? !this.permissions.availableFixLevels.includes(value) : value !== (this.settings.fixedLevel ?? 0)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${this.memberName}`); this.settings.fixedLevel = value; return this; }

    serialize(): NamespaceTreeNode {
        return structuredClone({ ...this.settings, type: this.type, fixedLevel: this.settings.fixedLevel as 0 | 1 | undefined,
            ...(this.namespaceDescription === undefined ? {} : { description: this.namespaceDescription }),
            children: Object.fromEntries([...this.members].map(([name, child]) => [name, child.serialize()])) });
    }

    /** @brief Accept direct member names only, excluding prototype and reserved object keys. */
    private validateName(name: string): void {
        if (!/^[A-Za-z_][\w$]*$/.test(name) || name.startsWith('__') || Object.hasOwn(Object.prototype, name) || ['prototype', 'then'].includes(name)) throw new Error(`Invalid Profile member name: ${name}`);
    }
}
