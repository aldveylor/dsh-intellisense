import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NamespaceTree, NamespaceTreeNode } from '../../src/web/panel/tree_node.js';
import { treeDisabledState, treeInspectWarning, treeInvalidState } from '../../src/web/panel/tree_state.js';
import { inNamespace } from '../../src/web/panel/namespace_tree.js';
import { TreeProvider } from '../../src/web/panel/tree_provider.js';
import { createNamespace } from '../namespace/fixtures.js';

test('inspect warning checks provided and mapped draft commands independently of physical tools', () => {
    const mappings = [{ id: 'read', path: 'files.read', pinned: false }];
    const provided = TreeProvider([...createNamespace({ tools: [], includeUnavailable: true }).children.values()].map(node => node.serialize()));
    const trees = [
        new NamespaceTree({ namespaces: [], mappings, order: [] }, provided, []),
        new NamespaceTree({ namespaces: [], mappings: [...mappings, { id: 'tools_inspect', path: 'tools.inspect', pinned: false, alwaysVisible: 2 }], order: [] }, [], []),
    ];
    for (const tree of trees) {
        const warning = (disabled: string[] = []): boolean => {
            const states = treeDisabledState(tree.roots, disabled, [], []);
            return treeInspectWarning(tree.roots, path => states.get(path)?.disabled ?? false);
        };
        assert.equal(warning(), false);
        assert.equal(warning(['tools.inspect']), true);
        assert.equal(warning(['tools']), true);
        assert.equal(warning(), false);
    }
    const fixedMappings = [...mappings.map(mapping => ({ ...mapping, alwaysVisible: 2 as const })),
        { id: 'read', path: 'files.hidden', pinned: false, disabled: true }];
    const tree = new NamespaceTree({ namespaces: [], mappings: fixedMappings, order: [] }, [], []);
    const states = treeDisabledState(tree.roots, [], [], fixedMappings);
    assert.equal(treeInspectWarning(tree.roots, path => states.get(path)?.disabled ?? false), false);
});

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

test('stored permissions retain existing children while limiting namespace and command edits', () => {
    const tree = new NamespaceTree({
        namespaces: [{ path: 'files', description: 'Files', alwaysVisible: false }],
        mappings: [{ id: 'read', path: 'files.read', pinned: false }], order: [],
        nodeSettings: { children: { files: { permissions: { acceptsChildren: false }, children: { read: { permissions: { removable: false, movable: false } } } } } },
    }, [], []);
    const files = tree.root.resolve(['files'])!;
    const read = tree.root.resolve(['files', 'read'])!;
    assert.equal(files.permissions.acceptsChildren, false);
    assert.equal(read.permissions.removable, false);
    assert.equal(read.permissions.movable, false);
    assert.throws(() => (files as NamespaceTreeNode).remove('read'), /cannot be removed/);
});

test('unavailable state propagates through nonempty namespaces independently of disable flags', () => {
    const mappings = [
        { id: 'missing', path: 'lost.nested.read', pinned: false, disabled: true },
        { id: 'missing', path: 'mixed.lost.read', pinned: false },
        { id: 'read', path: 'mixed.read', pinned: false, disabled: true },
        { id: 'missing', path: 'with_empty.read', pinned: false },
    ];
    const namespaces = [
        { path: 'lost', disabled: true, description: '', alwaysVisible: false },
        { path: 'empty', description: '', alwaysVisible: false },
        { path: 'with_empty.empty', description: '', alwaysVisible: false },
    ];
    const provided = TreeProvider([...createNamespace({ tools: [], includeUnavailable: true }).children.values()].map(node => node.serialize()));
    const tree = new NamespaceTree({ namespaces, mappings, order: [] }, provided, []);
    const tools = new Map([['read', { id: 'read', description: '', parameters: {} }]]);
    assert.deepEqual([...treeInvalidState(tree.roots, tools)].sort(), [
        'lost', 'lost.nested', 'lost.nested.read', 'mixed.lost', 'mixed.lost.read', 'with_empty.read',
    ]);
    tools.set('missing', { id: 'missing', description: '', parameters: {} });
    assert.deepEqual([...treeInvalidState(tree.roots, tools)], []);
});
