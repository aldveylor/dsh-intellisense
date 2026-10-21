import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type Mapping } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

test('command pinning has two states and custom prompt notes never replace IntelliSense documentation', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Original command documentation', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path' } } }, output: { type: 'string' } }]);
    const mapping: Mapping = { id: 'read', path: 'read', aliases: [], enabled: true, pinned: false };
    await registry.configure([mapping], 0);
    assert.deepEqual(registry.namespaceVisibility(), []);
    await registry.configure([{ ...mapping, alwaysVisible: true, description: 'Custom prompt note' }], 1);
    const hint = registry.namespaceVisibility()[0]!;
    assert.match(hint, /Custom prompt note/); assert.match(hint, /args:/);
    assert(!hint.includes('Original command documentation'));
    assert.match(registry.declarations(), /Original command documentation/);
    assert(!registry.declarations().includes('Custom prompt note'));
    assert.deepEqual(registry.namespaceVisibility(new Set()), []);
    await registry.configure([{ ...mapping, alwaysVisible: true }], 2);
    assert.match(registry.namespaceVisibility()[0]!, /Original command documentation/);
    await registry.configure([{ ...mapping, alwaysVisible: false }], 3);
    assert.deepEqual(registry.namespaceVisibility(), []);
});
