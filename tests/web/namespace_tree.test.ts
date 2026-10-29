import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namespacePaths, renameNamespace, deleteNamespace, orderedPaths, dropTree, type TreeDraft } from '../../src/web/panel/namespace_tree.js';

/** @brief A mixed tree with nested namespaces and a tool also mapped outside its main namespace. */
function draft(): TreeDraft {
    return {
        namespaces: [{ path: 'files', alwaysVisible: true, description: 'Files' }, { path: 'files.disk', alwaysVisible: false, description: 'Disk' }],
        mappings: [
            { id: 'read', path: 'files.disk.read', pinned: false, alwaysVisible: 2 },
            { id: 'write', path: 'files.write', pinned: false },
            { id: 'read', path: 'other.read', pinned: false, alwaysVisible: 2 },
        ],
        order: ['files', 'files.write', 'files.disk', 'files.disk.read', 'other', 'other.read'],
    };
}

test('namespace rename migrates descendants, mappings, pin state and order without changing physical identities', () => {
    const original = draft();
    const next = renameNamespace(original, 'files', 'workspace');
    assert.deepEqual(next.namespaces.map(n => n.path), ['workspace', 'workspace.disk']);
    assert.equal(next.namespaces[0]!.description, 'Files');
    assert.equal(next.namespaces[0]!.alwaysVisible, true);
    assert.equal(next.mappings[0]!.id, 'read');
    assert.equal(next.mappings[0]!.path, 'workspace.disk.read');
    assert.equal(next.mappings[2]!.path, 'other.read');
    assert.equal(next.mappings[0]!.alwaysVisible, 2);
    assert.deepEqual(next.order.slice(0, 4), ['workspace', 'workspace.write', 'workspace.disk', 'workspace.disk.read']);
    assert.equal(original.mappings[0]!.path, 'files.disk.read');
    assert.throws(() => renameNamespace(original, 'files', 'other'), /namespace_name_conflict/);
    assert.throws(() => renameNamespace(original, 'files', 'constructor'), /invalid_namespace_path/);
});

test('namespace deletion removes the subtree while retaining outside mappings and tool identity', () => {
    const next = deleteNamespace(draft(), 'files');
    assert.deepEqual(next.namespaces, []);
    assert.equal(next.mappings.length, 1);
    assert.equal(next.mappings[0]!.id, 'read');
    assert.equal(next.mappings[0]!.path, 'other.read');
    assert.equal(next.mappings[0]!.alwaysVisible, 2);
    assert.deepEqual(namespacePaths(next), ['other']);
    assert.deepEqual(next.order, ['other', 'other.read']);
});

test('mixed namespace/function order changes only for siblings and survives a namespace rename', () => {
    const current = draft();
    const before = dropTree(current, { namespace: true, path: 'files.disk' }, { path: 'files.write', position: 'before' });
    assert.deepEqual(orderedPaths(['files.write', 'files.disk'], before.order), ['files.disk', 'files.write']);
    const after = dropTree(before, { namespace: true, path: 'files.disk' }, { path: 'files.write', position: 'after' });
    assert.deepEqual(orderedPaths(['files.disk', 'files.write'], after.order), ['files.write', 'files.disk']);
    const renamed = renameNamespace(before, 'files.disk', 'local');
    assert.deepEqual(orderedPaths(['files.write', 'files.local'], renamed.order), ['files.local', 'files.write']);
});

test('subtree edits respect locked mapping paths', () => {
    const current = draft(); current.mappings[0]!.pinned = true;
    assert.throws(() => renameNamespace(current, 'files', 'workspace'), /locked_namespace_mapping/);
    assert.throws(() => deleteNamespace(current, 'files'), /locked_namespace_mapping/);
});
