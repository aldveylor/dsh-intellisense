import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegistryConfiguration, SemanticRegistry, type RegistryStateData } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Persisted preferences containing removed protected namespaces and commands. */
function staleConfiguration(): RegistryConfiguration {
    return new RegistryConfiguration({
        mappings: [{ id: 'read', path: 'files.read', pinned: false }],
        builtinVisible: { 'console.log': 2, 'tools.removed': 1, 'tools.search': 1 },
        builtinDisabled: ['console', 'console.log', 'tools.removed', 'tools.intellisense', 'tools.search'],
        namespaceVisible: { console: true, 'tools.removed': true, tools: true, files: true },
        order: ['console', 'console.log', 'tools.removed', 'tools', 'tools.search', 'files', 'files.read'],
    });
}

for (const scope of ['global', 'session'] as const) test(`${scope} load removes stale protected preferences and persists active and archived Profiles`, async () => {
    const store = new MemoryStore();
    await store.save('registry', { ...staleConfiguration().save(), version: 1, revision: 4,
        inactiveProfiles: { Other: staleConfiguration().save() } });
    const registry = new SemanticRegistry(store, scope);
    await registry.load();
    for (const configuration of [registry.configuration(), registry.configuration('Other')]) {
        assert.deepEqual(configuration.builtinVisible, { 'tools.search': 1 });
        assert.deepEqual(configuration.builtinDisabled, ['tools.intellisense', 'tools.search']);
        assert.deepEqual(configuration.namespaceVisible, { tools: true, files: true });
        assert.deepEqual(configuration.order, ['tools', 'tools.search', 'files', 'files.read']);
        assert.deepEqual(configuration.mappings, staleConfiguration().mappings);
    }
    const saved = await store.load<RegistryStateData>('registry');
    assert.deepEqual(saved!.builtinDisabled, ['tools.intellisense', 'tools.search']);
    assert.deepEqual(saved!.inactiveProfiles!.Other!.builtinVisible, { 'tools.search': 1 });
    assert.equal(saved!.revision, 4);
    store.save = async () => { throw new Error('Unexpected rewrite'); };
    await new SemanticRegistry(store, scope).load();
});

test('failed cleanup persistence leaves memory and storage unchanged and permits a later retry', async () => {
    const store = new MemoryStore();
    const data = { ...staleConfiguration().save(), version: 1, revision: 4 };
    await store.save('registry', data);
    const registry = new SemanticRegistry(store);
    const before = registry.snapshot();
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(await store.load('registry'), data);
    store.save = save;
    await registry.load();
    assert.deepEqual(registry.snapshot().builtinDisabled, ['tools.intellisense', 'tools.search']);
});
