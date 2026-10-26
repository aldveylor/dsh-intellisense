import type { PhysicalTool } from '../../registry/registry.js';
import type { ProvidedNamespace } from './tree_provider.js';
import { namespacePaths, orderedPaths, type TreeDraft } from './namespace_tree.js';
import { NamespaceTreeNode } from './tree_nodes/namespace_tree_node.js';
import { CommandTreeNode } from './tree_nodes/command_tree_node.js';
import { ProvidedNamespaceTreeNode } from './tree_nodes/provided_namespace_tree_node.js';
import type { TreeNode } from './tree_nodes/tree_node.js';
export { TreeNode, type TreeRenderer } from './tree_nodes/tree_node.js';
export { CommandTreeNode } from './tree_nodes/command_tree_node.js';
export { NamespaceTreeNode } from './tree_nodes/namespace_tree_node.js';
export { ProvidedCommandTreeNode } from './tree_nodes/provided_command_tree_node.js';
export { ProvidedNamespaceTreeNode } from './tree_nodes/provided_namespace_tree_node.js';

/** @brief Assemble an ordered node tree from Profile data and runtime namespace contracts. */
export class NamespaceTree {
    readonly root = new NamespaceTreeNode('');

    /** @brief Expose root children to the existing recursive renderer. */
    get roots(): TreeNode[] { return this.root.children; }

    constructor(draft: TreeDraft, provided: readonly ProvidedNamespace[], tools: readonly PhysicalTool[]) {
        this.root.children.push(...provided.map(namespace => new ProvidedNamespaceTreeNode(namespace, this.root)));
        /** @brief Create each missing namespace along the parent-child chain. */
        const ensureNamespace = (path: string): NamespaceTreeNode => {
            if (!path) return this.root;
            const parts = path.split('.');
            const parent = ensureNamespace(parts.slice(0, -1).join('.'));
            const existing = parent.children.find(node => node.name === parts.at(-1));
            if (existing instanceof NamespaceTreeNode) return existing;
            const node = new NamespaceTreeNode(parts.at(-1)!, parent, draft.namespaces.find(namespace => namespace.path === path));
            if (parent.permissions.acceptsChildren) parent.children.push(node);
            return node;
        };
        for (const path of namespacePaths(draft)) ensureNamespace(path);
        for (const mapping of draft.mappings) {
            const path = mapping.path;
            const parts = path.split('.');
            const parent = ensureNamespace(parts.slice(0, -1).join('.'));
            const tool = tools.find(tool => tool.id === mapping.id);
            if (parent.permissions.acceptsChildren) parent.children.push(new CommandTreeNode(parts.at(-1)!, parent, mapping, tool?.description, tool));
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
