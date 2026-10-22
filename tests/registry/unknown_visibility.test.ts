import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

const tool = { id: 'read', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, output: { type: 'string' } };

test('unknown pins persist independently of mappings and contribute visible tool signatures', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    registry.refresh([tool]);
    await registry.configure([], 0, [], [], ['read']);
    assert.deepEqual(registry.snapshot().mappings, []);
    assert.deepEqual(registry.snapshot().namespaces, []);
    assert.equal(registry.effective()[0]!.alwaysVisible, true);
    assert.match(registry.namespaceVisibility().join('\n'), /unknown.read\(args:/);
    assert.deepEqual(registry.namespaceVisibility(new Set()), []);
    const restored = new SemanticRegistry(store); await restored.load(); restored.refresh([tool]);
    assert.equal(restored.effective()[0]!.alwaysVisible, true);
    await restored.configure([], 1, [], [], []);
    assert.equal(restored.effective()[0]!.alwaysVisible, false);
    assert.deepEqual(restored.namespaceVisibility(), []);
    await assert.rejects(restored.configure([], 2, [], [], [1] as unknown as string[]), /Invalid unknown/);
});

test('visibility follows a pinned tool when mounted and when it returns to unknown', async () => {
    const registry = new SemanticRegistry(new MemoryStore()); registry.refresh([tool]);
    await registry.configure([], 0, [], [], ['read']);
    await registry.configure([{ id: 'read', path: 'std.read', aliases: [], enabled: true, pinned: false }], 1);
    assert.equal(registry.snapshot().mappings[0]!.alwaysVisible, true);
    assert.deepEqual(registry.snapshot().unknownVisible, []);
    await registry.configure([], 2);
    assert.deepEqual(registry.snapshot().unknownVisible, ['read']);
    assert.equal(registry.effective()[0]!.path, 'unknown.read');
    assert.equal(registry.effective()[0]!.alwaysVisible, true);
});
