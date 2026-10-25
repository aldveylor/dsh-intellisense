import type { Mapping, Namespace, PhysicalTool } from '../../registry/registry.js';
import { fixLevel, nodePermissions, type Node, type NodeType, type NodePermissions, type SerializedNode } from '../../integration/node.js';
import type { ProvidedCommand, ProvidedNamespace } from './tree_provider.js';
import { namespacePaths, orderedPaths, type TreeDraft } from './namespace_tree.js';

/** @brief Render tree nodes through their concrete command or namespace behavior. */
export interface TreeRenderer<T> {
    command(node: CommandTreeNode): T;
    namespace(node: NamespaceTreeNode): T;
}

/** @brief Browser node implements the same structural identity and policies as executable nodes. */
export abstract class TreeNode implements Node {
    abstract readonly type: NodeType;

    constructor(readonly name: string, readonly parent: NamespaceTreeNode | undefined = undefined) {}

    /** @brief Derive boundary paths from parent references instead of storing a second identity. */
    get path(): string { return this.parent?.path ? `${this.parent.path}.${this.name}` : this.name; }

    /** @brief Share permission choices with the integration node model. */
    get permissions(): NodePermissions { return nodePermissions(this.type, this.path); }

    /** @brief Whether structural editing is prohibited for this node. */
    get fixed(): boolean { return !this.permissions.rename && !this.permissions.move && !this.permissions.remove; }

    /** @brief Serialize this node without retaining its parent reference. */
    abstract serialize(): SerializedNode;

    /** @brief Keep JSON serialization independent of cyclic parent references. */
    toJSON(): SerializedNode { return this.serialize(); }

    /** @brief Dispatch rendering to the concrete node implementation. */
    abstract render<T>(renderer: TreeRenderer<T>): T;
}

/** @brief An editable physical command mapping or one of its aliases. */
export class CommandTreeNode extends TreeNode {
    readonly type: NodeType = 'command';

    constructor(name: string, parent: NamespaceTreeNode, readonly mapping?: Mapping, readonly description?: string, readonly physical?: PhysicalTool) { super(name, parent); }

    /** @brief Optional builtin contract used for command presentation and pinning. */
    get command(): ProvidedCommand | undefined { return undefined; }

    /** @brief Whether the command may be moved by the tree editor. */
    get draggable(): boolean { return this.permissions.move && !this.mapping?.pinned; }

    /** @brief Resolve a saved pin using this node's available fix levels. */
    get level(): 0 | 1 | 2 { return fixLevel(this.permissions, this.command?.alwaysVisible ?? this.mapping?.alwaysVisible); }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions,
            command: { tool: this.mapping?.id ?? this.command?.id ?? this.path, schema: this.physical?.parameters ?? {}, output: this.physical?.output, doc: this.description ?? '' } });
    }

    /** @brief Render a command without requiring callers to inspect node flags. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.command(this); }
}

/** @brief A plugin command retains its contract and shared builtin permissions. */
export class BuiltinCommandTreeNode extends CommandTreeNode {
    override readonly type: NodeType = 'inner_command';

    constructor(private readonly contract: ProvidedCommand, parent: NamespaceTreeNode) { super(contract.path.split('.').at(-1)!, parent, undefined, contract.description); }

    /** @brief Expose the builtin command contract. */
    override get command(): ProvidedCommand { return this.contract; }

    /** @brief Use provider-supplied permission choices when a builtin customizes them. */
    override get permissions(): NodePermissions { return this.contract.permissions; }

    override serialize(): SerializedNode {
        return { ...super.serialize(), builtin: { path: this.path, tool: this.contract.id ?? this.path, signature: this.contract.signature ?? '', description: this.contract.description } };
    }
}

/** @brief An editable namespace owns ordered child references and counts descendant commands. */
export class NamespaceTreeNode extends TreeNode {
    readonly type: NodeType = 'namespace';
    readonly children: TreeNode[] = [];

    constructor(name: string, parent?: NamespaceTreeNode, readonly metadata?: Namespace) { super(name, parent); }

    /** @brief Follow direct child references from this namespace. */
    resolve(parts: readonly string[]): TreeNode | undefined {
        const [name, ...remaining] = parts;
        if (name === undefined) return this;
        const child = this.children.find(node => node.name === name);
        return remaining.length ? child instanceof NamespaceTreeNode ? child.resolve(remaining) : undefined : child;
    }

    /** @brief Namespace documentation displayed by the editor. */
    get description(): string { return this.metadata?.description ?? ''; }

    /** @brief Select editable, locked or native console namespace pin behavior. */
    get pinMode(): 'profile' | 'locked' | 'console' { return 'profile'; }

    /** @brief Number of commands represented by this namespace. */
    get count(): number { return this.children.reduce((count, child) => count + (child instanceof NamespaceTreeNode ? child.count : 1), 0); }

    serialize(): SerializedNode { return { type: this.type, name: this.name, permissions: this.permissions, children: this.children.map(node => node.serialize()) }; }

    /** @brief Render a namespace through the same interface as command leaves. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.namespace(this); }
}

/** @brief A fixed runtime namespace owns builtin descendants and locked pin policy. */
export class BuiltinNamespaceTreeNode extends NamespaceTreeNode {
    override readonly type: NodeType = 'inner_namespace';

    constructor(private readonly contract: ProvidedNamespace, parent: NamespaceTreeNode) {
        super(contract.path.split('.').at(-1)!, parent);
        this.children.push(...contract.commands.map(command => new BuiltinCommandTreeNode(command, this)),
            ...(contract.children ?? []).map(namespace => new BuiltinNamespaceTreeNode(namespace, this)));
    }

    /** @brief Use the shared permission policy supplied for this builtin namespace. */
    override get permissions(): NodePermissions { return this.contract.permissions; }

    /** @brief Use the builtin namespace documentation. */
    override get description(): string { return this.contract.description; }

    /** @brief Select the pin behavior from the shared builtin namespace permission policy. */
    override get pinMode(): 'locked' | 'console' { return this.permissions.fixLevels.length ? 'console' : 'locked'; }

    /** @brief Preserve the builtin namespace direct-member count. */
    override get count(): number { return this.children.length; }
}

/** @brief The anonymous browser root mirrors the integration root namespace node. */
export class RootNamespaceTreeNode extends NamespaceTreeNode {
    override readonly type: NodeType = 'root_namespace';

    constructor() { super(''); }
}

/** @brief Assemble an ordered node tree from Profile data and runtime namespace contracts. */
export class NamespaceTree {
    readonly root = new RootNamespaceTreeNode();

    /** @brief Expose root children to the existing recursive renderer. */
    get roots(): TreeNode[] { return this.root.children; }

    constructor(draft: TreeDraft, provided: readonly ProvidedNamespace[], tools: readonly PhysicalTool[]) {
        this.root.children.push(...provided.map(namespace => new BuiltinNamespaceTreeNode(namespace, this.root)));
        /** @brief Create each missing namespace along the parent-child chain. */
        const ensureNamespace = (path: string): NamespaceTreeNode => {
            if (!path) return this.root;
            const parts = path.split('.');
            const parent = ensureNamespace(parts.slice(0, -1).join('.'));
            const existing = parent.children.find(node => node.name === parts.at(-1));
            if (existing instanceof NamespaceTreeNode) return existing;
            const node = new NamespaceTreeNode(parts.at(-1)!, parent, draft.namespaces.find(namespace => namespace.path === path));
            if (!parent.fixed || parent === this.root) parent.children.push(node);
            return node;
        };
        for (const path of namespacePaths(draft)) ensureNamespace(path);
        for (const mapping of draft.mappings) for (const path of [mapping.path, ...mapping.aliases]) {
            const parts = path.split('.');
            const parent = ensureNamespace(parts.slice(0, -1).join('.'));
            const tool = tools.find(tool => tool.id === mapping.id);
            if (!parent.fixed || parent === this.root) parent.children.push(new CommandTreeNode(parts.at(-1)!, parent, mapping, tool?.description, tool));
        }
        /** @brief Apply Profile ordering recursively to editable branches. */
        const sort = (nodes: TreeNode[]): void => {
            const rank = new Map(orderedPaths(nodes.map(node => node.path), draft.order).map((path, index) => [path, index]));
            nodes.sort((a, b) => rank.get(a.path)! - rank.get(b.path)!);
            for (const node of nodes) if (node instanceof NamespaceTreeNode && !node.fixed) sort(node.children);
        };
        sort(this.roots);
    }
}
