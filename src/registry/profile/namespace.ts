import { ProfileNode } from './node.js';
import { ProfileCommand } from './command.js';
import type { NamespaceTreeNode } from '../profile_node.js';

/** @brief Constructor accepted by a directly nested namespace collection. */
export type ProfileNodeClass<T extends ProfileNode> = new (name?: string) => T;

/** @brief An editable recursive namespace containing directly named child objects. */
export class ProfileNamespace extends ProfileNode {
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
                this.members.set(name, child.type === 'namespace' ? new ProfileNamespace(name, child) : new ProfileCommand(name, child));
            }
        }
    }

    get children(): ReadonlyMap<string, ProfileNode> { return this.members; }

    /** @brief Read one direct member, optionally checking its concrete node class. */
    get(name: string): ProfileNode | undefined;
    get<T extends ProfileNode>(name: string, Node: ProfileNodeClass<T>): T | undefined;
    get(name: string, Node?: ProfileNodeClass<ProfileNode>): ProfileNode | undefined {
        this.validateName(name);
        const node = this.members.get(name);
        if (node && Node && !(node instanceof Node)) throw new Error(`Profile node type mismatch: ${name}`);
        return node;
    }

    /** @brief Create a new direct member; duplicate names are rejected. */
    create<T extends ProfileNode>(name: string, Node: ProfileNodeClass<T>): T {
        this.validateName(name);
        if (this.members.has(name)) throw new Error(`Profile member already exists: ${name}`);
        const node = new Node(name);
        this.members.set(name, node);
        return node;
    }

    /** @brief Return a matching direct member or create it once. */
    getOrCreate<T extends ProfileNode>(name: string, Node: ProfileNodeClass<T>): T { return this.get(name, Node) ?? this.create(name, Node); }

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
