import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTree, namespacePaths, orderedPaths, type TreeDraft } from '../../src/management/panel/namespace_tree.js';

/** @brief A cross-namespace drag fixture with both existing commands and a nested namespace. */
function draft(): TreeDraft {
    return {
        namespaces: [{ path: 'left', alwaysVisible: false, description: 'Left' }, { path: 'left.child', alwaysVisible: true, description: 'Child' }, { path: 'right', alwaysVisible: false, description: 'Right' }],
        mappings: [{ id: 'read', path: 'left.child.read', aliases: [], enabled: true, pinned: false }, { id: 'write', path: 'right.write', aliases: [], enabled: true, pinned: false }],
        order: ['left', 'left.child', 'left.child.read', 'right', 'right.write'],
    };
}

test('physical blocks mount on namespace interiors and directly before or after commands', () => {
    const start = draft();
    const mounted = dropTree(start, { namespace: false, id: 'new' }, { path: 'right', position: 'inside' }, 'create');
    assert.equal(mounted.mappings.at(-1)!.path, 'right.create');
    const before = dropTree(mounted, { namespace: false, id: 'new', path: 'right.create' }, { path: 'right.write', position: 'before' });
    assert.deepEqual(orderedPaths(['right.write', 'right.create'], before.order), ['right.create', 'right.write']);
    const after = dropTree(start, { namespace: false, id: 'new' }, { path: 'right.write', position: 'after' }, 'create');
    assert.deepEqual(orderedPaths(['right.create', 'right.write'], after.order), ['right.write', 'right.create']);
    assert.equal(start.mappings.length, 2);
});

test('cross-namespace command insertion changes its path and inserts at the exact destination', () => {
    const next = dropTree(draft(), { namespace: false, id: 'read', path: 'left.child.read' }, { path: 'right.write', position: 'before' });
    assert.equal(next.mappings[0]!.path, 'right.read');
    assert.deepEqual(orderedPaths(['right.write', 'right.read'], next.order), ['right.read', 'right.write']);
    assert(namespacePaths(next).includes('left.child'));
    const root = dropTree(next, { namespace: false, id: 'read', path: 'right.read' }, { path: '', position: 'inside' });
    assert.equal(root.mappings[0]!.path, 'read');
});

test('namespace moves migrate entire subtrees and reject cycles and collisions', () => {
    const start = draft();
    const next = dropTree(start, { namespace: true, path: 'left.child' }, { path: 'right', position: 'inside' });
    assert.equal(next.mappings[0]!.path, 'right.child.read');
    assert.equal(next.namespaces.find(n => n.path === 'right.child')!.description, 'Child');
    assert.equal(next.namespaces.find(n => n.path === 'right.child')!.alwaysVisible, true);
    assert.equal(start.mappings[0]!.path, 'left.child.read');
    assert.throws(() => dropTree(start, { namespace: true, path: 'left' }, { path: 'left.child', position: 'inside' }), /namespace_cycle/);
    const conflict = { ...start, namespaces: [...start.namespaces, { path: 'right.child', alwaysVisible: false, description: '' }] };
    assert.throws(() => dropTree(conflict, { namespace: true, path: 'left.child' }, { path: 'right', position: 'inside' }), /namespace_name_conflict/);
});
