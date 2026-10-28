import { memo } from 'react';
import type { TreeNode } from '../tree_node.js';
import type { TreeProps } from './tree_props.js';
import { TooltipProvider } from '../../ui/tooltip/tooltip.js';
import { CommandNode } from './command_node.js';
import { NamespaceNode } from './namespace_node.js';
import { NamespacePlaceholder } from './namespace_placeholder.js';

/** @brief Render concrete node behavior through the tree renderer interface. */
function TreeNodeView({ node, tree }: { node: TreeNode; tree: TreeProps }) {
    return node.render({ command: command => <CommandNode node={command} tree={tree} />, namespace: namespace => <NamespaceNode node={namespace} tree={tree}>{namespace.children.map(child => <TreeNodeView key={child.path} node={child} tree={tree} />)}{namespace.permissions.acceptsChildren && <NamespacePlaceholder parent={namespace.path} busy={tree.busy} create={tree.create} drop={tree.drop} pick={tree.pick} />}</NamespaceNode> });
}

/** @brief Render tree rows independently from Profile requests and dialog state. */
export const NamespaceTreeView = memo(function NamespaceTreeView({ roots, tree }: { roots: readonly TreeNode[]; tree: TreeProps }) {
    return <TooltipProvider><ul className="ts-tree">{roots.map(node => <TreeNodeView key={node.path} node={node} tree={tree} />)}
        <NamespacePlaceholder busy={tree.busy} create={tree.create} pick={tree.pick} drop={tree.drop} />
    </ul></TooltipProvider>;
});

