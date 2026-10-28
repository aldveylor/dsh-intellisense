import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NamespaceTree, NamespaceTreeNode } from '../../src/management/panel/tree_node.js';
import { treeDisabledState } from '../../src/management/panel/tree_state.js';
import { inNamespace } from '../../src/management/panel/namespace_tree.js';
import { TreeProvider } from '../../src/management/panel/tree_provider.js';
import { createNamespace } from '../../src/namespace/namespace.js';

test('indexed disable flags preserve ancestor, own command and provided node rules', () => {
    const namespaces = [{ path: 'files', disabled: true, description: '', alwaysVisible: false }];
    const mappings = [
        { id: 'read', path: 'files.nested.read', pinned: false },
        { id: 'read', path: 'files_extra.read', pinned: false },
        { id: 'write', path: 'other.write', pinned: false, disabled: true },
    ];
    const builtinDisabled = ['tools.profile'];
    const provided = TreeProvider([...createNamespace({ tools: [], includeUnavailable: true }).children.values()].map(node => node.serialize()));
    const tree = new NamespaceTree({ namespaces, mappings, order: [] }, provided, []);
    const states = treeDisabledState(tree.roots, builtinDisabled, namespaces, mappings);
    for (const [path, state] of states) {
        const node = tree.root.resolve(path.split('.'))!;
        const disabledByAncestor = builtinDisabled.some(prefix => prefix !== path && inNamespace(path, prefix))
            || namespaces.some(item => item.disabled && item.path !== path && inNamespace(path, item.path));
        const disabled = node.permissions.disableable && (builtinDisabled.some(prefix => inNamespace(path, prefix))
            || namespaces.some(item => item.disabled && inNamespace(path, item.path))
            || mappings.some(item => item.disabled && item.path === path));
        assert.deepEqual(state, { disabled, disabledByAncestor }, path);
    }
    assert.equal(states.get('files.nested.read')!.disabledByAncestor, true);
    assert.equal(states.get('files_extra.read')!.disabled, false);
    assert.equal(states.get('other.write')!.disabledByAncestor, false);
    const enabled = treeDisabledState(tree.roots, [], [], mappings);
    assert.equal(enabled.get('files.nested.read')!.disabled, false);
    assert.equal(enabled.get('other.write')!.disabled, true);
});

test('cached subtree counts update ancestors after membership edits and retain provided direct counts', () => {
    const provided = TreeProvider([...createNamespace({ tools: [], includeUnavailable: true }).children.values()].map(node => node.serialize()));
    const tree = new NamespaceTree({ namespaces: [], mappings: [
        { id: 'read', path: 'files.nested.read', pinned: false },
        { id: 'write', path: 'files.write', pinned: false },
    ], order: [] }, provided, []);
    const files = tree.root.resolve(['files']) as NamespaceTreeNode;
    const nested = files.resolve(['nested']) as NamespaceTreeNode;
    const tools = tree.root.resolve(['tools']) as NamespaceTreeNode;
    assert.equal(files.count, 2);
    assert.equal(tools.count, tools.children.length);
    const initial = tree.root.count;
    assert.equal(nested.remove('read'), true);
    assert.equal(nested.count, 0);
    assert.equal(files.count, 1);
    assert.equal(tree.root.count, initial - 1);
    const write = files.resolve(['write'])!;
    assert.equal(files.remove('write'), true);
    assert.equal(tree.root.count, initial - 2);
    files.add(write);
    assert.equal(files.count, 1);
    assert.equal(tree.root.count, initial - 1);
    assert.equal(files.remove('missing'), false);
    assert.throws(() => tree.root.remove('tools'), /cannot be removed/);
});
