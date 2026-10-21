import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

test('pinned command hints and mixed tree order persist and honor agent visibility', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store);
    const tools = ['read', 'write'].map(id => ({ id, description: `${id} files`, parameters: { type: 'object' }, output: { type: 'string' } }));
    registry.refresh(tools);
    await registry.configure(tools.map(t => ({ id: t.id, path: `files.${t.id}`, aliases: [], enabled: true, pinned: false, alwaysVisible: t.id === 'read' })), 0,
        [{ path: 'files', alwaysVisible: false, description: '' }], ['files.write', 'files.read', 'files']);
    assert.deepEqual(registry.namespaceVisibility(), ['files.read — read files']);
    assert.deepEqual(registry.namespaceVisibility(new Set(['write'])), []);
    const restored = new SemanticRegistry(store); await restored.load(); restored.refresh(tools);
    assert.deepEqual(restored.snapshot().order, ['files.write', 'files.read', 'files']);
    assert.deepEqual(restored.namespaceVisibility(), ['files.read — read files']);
    await restored.configure(restored.snapshot().mappings.map(m => ({ ...m, alwaysVisible: false })), 1);
    assert.deepEqual(restored.namespaceVisibility(), []);
    await assert.rejects(restored.configure(restored.snapshot().mappings.map(m => ({ ...m, alwaysVisible: 'yes' as unknown as boolean })), 2), /Invalid mapping/);
});
