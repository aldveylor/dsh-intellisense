import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namespacePaths, renameNamespace, deleteNamespace, orderedPaths, reorderTree, type TreeDraft } from '../../src/management/panel/namespace_tree.js';

/** @brief A mixed tree with nested namespaces and a tool also mapped outside its main namespace. */
function draft(): TreeDraft {
    return {
        namespaces: [{ path: 'files', alwaysVisible: true, description: 'Files' }, { path: 'files.disk', alwaysVisible: false, description: 'Disk' }],
        mappings: [
            { id: 'read', path: 'files.disk.read', aliases: ['other.read'], enabled: true, pinned: false, alwaysVisible: true },
            { id: 'write', path: 'files.write', aliases: [], enabled: true, pinned: false },
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
    assert.deepEqual(next.mappings[0]!.aliases, ['other.read']);
    assert.equal(next.mappings[0]!.alwaysVisible, true);
    assert.deepEqual(next.order.slice(0, 4), ['workspace', 'workspace.write', 'workspace.disk', 'workspace.disk.read']);
    assert.equal(original.mappings[0]!.path, 'files.disk.read');
    assert.throws(() => renameNamespace(original, 'files', 'other'), /冲突/);
    assert.throws(() => renameNamespace(original, 'files', 'Promise'), /reserved/);
});

test('namespace deletion removes the subtree while retaining outside mappings and tool identity', () => {
    const next = deleteNamespace(draft(), 'files');
    assert.deepEqual(next.namespaces, []);
    assert.equal(next.mappings.length, 1);
    assert.equal(next.mappings[0]!.id, 'read');
    assert.equal(next.mappings[0]!.path, 'other.read');
    assert.equal(next.mappings[0]!.alwaysVisible, true);
    assert.deepEqual(namespacePaths(next), ['other']);
    assert.deepEqual(next.order, ['other', 'other.read']);
});

test('mixed namespace/command order changes only for siblings and survives a namespace rename', () => {
    const current = draft();
    const before = reorderTree(current, 'files.disk', 'files.write', false);
    assert.deepEqual(orderedPaths(['files.write', 'files.disk'], before), ['files.disk', 'files.write']);
    const after = reorderTree({ ...current, order: before }, 'files.disk', 'files.write', true);
    assert.deepEqual(orderedPaths(['files.disk', 'files.write'], after), ['files.write', 'files.disk']);
    assert.deepEqual(reorderTree(current, 'files.disk.read', 'files.write', false), current.order);
    const renamed = renameNamespace({ ...current, order: before }, 'files.disk', 'local');
    assert.deepEqual(orderedPaths(['files.write', 'files.local'], renamed.order), ['files.local', 'files.write']);
});

test('subtree edits respect locked mapping paths', () => {
    const current = draft(); current.mappings[0]!.pinned = true;
    assert.throws(() => renameNamespace(current, 'files', 'workspace'), /锁定/);
    assert.throws(() => deleteNamespace(current, 'files'), /锁定/);
});
