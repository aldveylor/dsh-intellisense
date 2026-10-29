import { EditableNode, type ProfileNode } from './node.js';
import { EditableCommand, type ProfileCommand } from './command.js';
import type { NamespaceTreeNode } from '../profile_node.js';

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
    private readonly members = new Map<string, ProfileNode>();
    private description?: string;

    constructor(name = '', data?: NamespaceTreeNode) {
        super(name);
        if (data) {
            this.restore(data);
            this.description = data.description;
            for (const [name, child] of Object.entries(data.children ?? {})) {
                this.validateName(name);
                this.members.set(name, child.type === 'namespace' ? new EditableNamespace(name, child) : new EditableCommand(name, child));
            }
        }
    }

    get children(): ReadonlyMap<string, ProfileNode> { return this.members; }

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
        if (this.members.has(name)) throw new Error(`Profile member already exists: ${name}`);
        const node = kind === 'namespace' ? new EditableNamespace(name) : new EditableCommand(name);
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
    remove(name: string): boolean { this.validateName(name); return this.members.delete(name); }

    /** @brief Set the namespace description. */
    setDescription(value: string): this { this.description = value; return this; }

    /** @brief Set whether this namespace is included in the prompt directory. */
    setFixedLevel(value: 0 | 1): this { this.settings.fixedLevel = value; return this; }

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
