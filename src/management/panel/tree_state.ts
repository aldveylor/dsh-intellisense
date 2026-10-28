import type { Mapping, Namespace } from '../../registry/registry.js';
import type { TreeNode } from './tree_nodes/tree_node.js';

/** @brief Index effective disable flags in one traversal while retaining each node's own permissions. */
export function treeDisabledState(roots: readonly TreeNode[], builtinDisabled: readonly string[], namespaces: readonly Namespace[], mappings: readonly Mapping[]): Map<string, { disabled: boolean; disabledByAncestor: boolean }> {
    const disabledNamespaces = new Set([...builtinDisabled, ...namespaces.filter(node => node.disabled).map(node => node.path)]);
    const disabledCommands = new Set(mappings.filter(mapping => mapping.disabled).map(mapping => mapping.path));
    const states = new Map<string, { disabled: boolean; disabledByAncestor: boolean }>();
    const visit = (node: TreeNode, ancestor: boolean): void => {
        const path = node.path;
        const disabled = ancestor || disabledNamespaces.has(path);
        states.set(path, { disabled: node.permissions.disableable && (disabled || disabledCommands.has(path)), disabledByAncestor: ancestor });
        node.render({ command: () => {}, namespace: namespace => namespace.children.forEach(child => visit(child, disabled)) });
    };
    roots.forEach(node => visit(node, false));
    return states;
}
