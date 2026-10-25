import type { Mapping, Namespace, PhysicalTool } from '../../registry/registry.js';
import type { ProvidedCommand, ProvidedNamespace } from './tree_provider.js';
import { namespacePaths, orderedPaths, type TreeDraft } from './namespace_tree.js';

/** @brief Render tree nodes through their concrete command or namespace behavior. */
export interface TreeRenderer<T> {
    command(node: CommandTreeNode): T;
    namespace(node: NamespaceTreeNode): T;
}

/** @brief Shared identity and interaction policies for every management tree node. */
export abstract class TreeNode {
    constructor(readonly path: string) {}

    /** @brief Whether structural editing is prohibited for this node. */
    get fixed(): boolean { return false; }

    /** @brief Dispatch rendering to the concrete node implementation. */
    abstract render<T>(renderer: TreeRenderer<T>): T;
}

/** @brief An editable physical command mapping or one of its aliases. */
export class CommandTreeNode extends TreeNode {
    constructor(path: string, readonly mapping?: Mapping, readonly description?: string) { super(path); }

    /** @brief Optional builtin contract used for command presentation and pinning. */
    get command(): ProvidedCommand | undefined { return undefined; }

    /** @brief Whether the command may be moved by the tree editor. */
    get draggable(): boolean { return !this.mapping?.pinned; }

    /** @brief Render a command without requiring callers to inspect node flags. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.command(this); }
}

/** @brief A plugin command retains its contract and prohibits structural editing. */
export class BuiltinCommandTreeNode extends CommandTreeNode {
    constructor(private readonly contract: ProvidedCommand) { super(contract.path, undefined, contract.description); }

    /** @brief Expose the builtin command contract. */
    override get command(): ProvidedCommand { return this.contract; }

    /** @brief Builtin nodes prohibit structural editing. */
    override get fixed(): boolean { return true; }

    /** @brief Use the movement policy supplied by the builtin provider. */
    override get draggable(): boolean { return this.contract.draggable; }
}

/** @brief An editable namespace owns its ordered children and counts descendant commands. */
export class NamespaceTreeNode extends TreeNode {
    readonly children: TreeNode[] = [];

    constructor(path: string, readonly metadata?: Namespace) { super(path); }

    /** @brief Namespace documentation displayed by the editor. */
    get description(): string { return this.metadata?.description ?? ''; }

    /** @brief Select editable, locked or native console namespace pin behavior. */
    get pinMode(): 'profile' | 'locked' | 'console' { return 'profile'; }

    /** @brief Number of commands represented by this namespace. */
    get count(): number { return this.children.reduce((count, child) => count + (child instanceof NamespaceTreeNode ? child.count : 1), 0); }

    /** @brief Render a namespace through the same interface as command leaves. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.namespace(this); }
}

/** @brief A fixed runtime namespace exposes its supplied children and locked pin policy. */
export class BuiltinNamespaceTreeNode extends NamespaceTreeNode {
    constructor(private readonly contract: ProvidedNamespace) {
        super(contract.path);
        this.children.push(...contract.commands.map(command => new BuiltinCommandTreeNode(command)),
            ...(contract.children ?? []).map(namespace => new BuiltinNamespaceTreeNode(namespace)));
    }

    /** @brief Builtin nodes prohibit structural editing. */
    override get fixed(): boolean { return true; }

    /** @brief Use the builtin namespace documentation. */
    override get description(): string { return this.contract.description; }

    /** @brief Select the pin behavior of this runtime namespace. */
    override get pinMode(): 'locked' | 'console' { return 'locked'; }

    /** @brief Preserve the builtin namespace direct-member count. */
    override get count(): number { return this.children.length; }
}

/** @brief The native console keeps fixed structure with a configurable namespace prompt pin. */
export class ConsoleNamespaceTreeNode extends BuiltinNamespaceTreeNode {
    /** @brief Select the pin behavior of this runtime namespace. */
    override get pinMode(): 'console' { return 'console'; }
}

/** @brief Assemble one ordered object tree from Profile data and runtime namespace contracts. */
export class NamespaceTree {
    readonly roots: TreeNode[];

    constructor(draft: TreeDraft, provided: readonly ProvidedNamespace[], tools: readonly PhysicalTool[]) {
        const branches = new Map(namespacePaths(draft).map(path => [path, new NamespaceTreeNode(path, draft.namespaces.find(namespace => namespace.path === path))]));
        for (const namespace of provided) branches.set(namespace.path, namespace.path === 'console' ? new ConsoleNamespaceTreeNode(namespace) : new BuiltinNamespaceTreeNode(namespace));
        this.roots = [];
        /** @brief Attach nodes to their editable parent or to the root list. */
        const append = (node: TreeNode): void => {
            const parent = branches.get(node.path.split('.').slice(0, -1).join('.'));
            if (!parent) this.roots.push(node);
            else if (!parent.fixed) parent.children.push(node);
        };
        for (const node of branches.values()) append(node);
        for (const mapping of draft.mappings) for (const path of [mapping.path, ...mapping.aliases]) {
            append(new CommandTreeNode(path, mapping, tools.find(tool => tool.id === mapping.id)?.description));
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
