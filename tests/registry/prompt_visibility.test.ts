import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type PinLevel } from '../../src/registry/registry.js';
import { manifest } from '../../src/namespace/namespace.js';
import { MemoryStore } from '../../src/storage/store.js';

test('pinned command hints and mixed tree order persist and honor agent visibility', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store);
    const tools = ['read', 'write'].map(id => ({ id, description: `${id} files`, parameters: { type: 'object' }, output: { type: 'string' } }));
    registry.refresh(tools);
    await registry.configure(tools.map(t => ({ id: t.id, path: `files.${t.id}`, pinned: false, alwaysVisible: t.id === 'read' ? 1 : 0 })), 0,
        [{ path: 'files', alwaysVisible: false, description: '' }], ['files.write', 'files.read', 'files']);
    assert.deepEqual(manifest(registry, []).commands().filter(entry => registry.effective().find(mapping => mapping.id === entry.tool)?.alwaysVisible).map(entry => entry.path), ['files.read']);
    assert.deepEqual(manifest(registry, []).commands().filter(entry => entry.tool === 'write' && registry.effective().find(mapping => mapping.id === entry.tool)?.alwaysVisible), []);
    const restored = new SemanticRegistry(store); await restored.load(); restored.refresh(tools);
    assert.deepEqual(restored.snapshot().order, ['files.write', 'files.read', 'files']);
    assert.deepEqual(manifest(restored, []).commands().filter(entry => restored.effective().find(mapping => mapping.id === entry.tool)?.alwaysVisible).map(entry => entry.path), ['files.read']);
    await restored.configure(restored.snapshot().mappings.map(m => ({ ...m, alwaysVisible: 0 as const })), 1);
    assert.deepEqual(manifest(restored, []).commands().filter(entry => restored.effective().find(mapping => mapping.id === entry.tool)?.alwaysVisible).map(entry => entry.path), []);
    await assert.rejects(restored.configure(restored.snapshot().mappings.map(m => ({ ...m, alwaysVisible: 'yes' as unknown as PinLevel })), 2), /Invalid mapping/);
});
