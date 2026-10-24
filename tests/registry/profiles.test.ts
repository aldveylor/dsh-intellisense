import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

const mapping = { id: 'read', path: 'files.read', aliases: [], enabled: true, pinned: false };

test('profiles isolate all configuration fields and persist create, select, rename and delete', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store);
    registry.refresh(['read', 'other'].map(id => ({ id, description: id, parameters: { type: 'object' }, output: { type: 'string' } })));
    assert.equal(registry.snapshot().profile, 'Default');
    await registry.configure([mapping], 0, [{ path: 'files', description: 'Files', alwaysVisible: true }], ['files'], { other: 2 });
    await registry.manageProfile('create', 'Work', 1);
    assert.deepEqual(registry.snapshot().mappings, []);
    assert.deepEqual(registry.snapshot().unmountedVisible, {});
    await registry.configure([], 2, [{ path: 'work', description: 'Work', alwaysVisible: false }], ['work'], { read: 1 });
    await registry.manageProfile('select', 'Default', 3);
    assert.deepEqual(registry.snapshot().mappings, [mapping]);
    assert.deepEqual(registry.snapshot().unmountedVisible, { other: 2 });
    assert.deepEqual(registry.snapshot().order, ['files', 'files.read']);
    await registry.manageProfile('rename', 'Work', 4, 'Office');
    const restored = new SemanticRegistry(store); await restored.load();
    assert.deepEqual(restored.snapshot().profiles, ['Default', 'Office']);
    assert(!('inactiveProfiles' in restored.snapshot()));
    await restored.manageProfile('select', 'Office', 5);
    assert.deepEqual(restored.snapshot().namespaces, [{ path: 'work', description: 'Work', alwaysVisible: false }]);
    assert.deepEqual(restored.snapshot().unmountedVisible, { read: 1 });
    await restored.manageProfile('rename', 'Office', 6, 'Personal');
    await restored.manageProfile('delete', 'Personal', 7);
    assert.equal(restored.snapshot().profile, 'Default');
    assert.deepEqual(restored.snapshot().mappings, [mapping]);
    await assert.rejects(restored.manageProfile('delete', 'Default', 8), /At least one/);
});

test('invalid profile changes and failed persistence leave active configuration unchanged', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store);
    await registry.manageProfile('create', 'Work', 0);
    await assert.rejects(registry.manageProfile('create', 'Work', 1), /already exists/);
    await assert.rejects(registry.manageProfile('rename', 'Work', 1, 'Default'), /already exists/);
    await assert.rejects(registry.manageProfile('select', 'Default', 0), /revision conflict/);
    await assert.rejects(registry.manageProfile('create', '__proto__', 1), /Invalid profile/);
    const before = registry.snapshot();
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.manageProfile('select', 'Default', 1), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
});
