import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type ProfileCatalogData } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { storageVersion } from '../../src/storage/version.js';

/** @brief Create a current-format global catalog with multiple independent named references. */
async function fixture() {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.saveProfile('Work', { ...registry.configuration(), brief: 'Work' });
    return { store, registry, saved: (await store.load<ProfileCatalogData>('registry'))! };
}

test('global storage contains current anonymous Profiles and numeric pointers', async () => {
    const { store, registry, saved } = await fixture();
    assert.equal(saved.version, storageVersion);
    assert.equal(saved.profiles.Work.brief, 'Work');
    assert.equal(typeof saved.profiles.Work.pointer, 'number');
    assert.equal('name' in saved.profiles.Work, false);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert.equal((await restored.reference('Work')).pointer, (await registry.reference('Work')).pointer);
});

test('obsolete configuration storage is rejected instead of implicitly converted', async () => {
    const store = new MemoryStore();
    await store.save('registry', { version: 2, revision: 0, profile: 'Default', mappings: [] });
    await assert.rejects(new SemanticRegistry(store).load(), /Invalid Profile reference catalog/);
});

test('invalid current pointers are rejected and explicit recovery retains valid Profiles', async () => {
    const { store, saved } = await fixture();
    saved.profiles.Work.pointer = Number.MAX_SAFE_INTEGER;
    await store.save('registry', saved);
    const restored = new SemanticRegistry(store);
    await assert.rejects(restored.load(), /Invalid Profile reference/);
    await restored.load(true);
    assert.deepEqual(restored.profileSelection().profiles, ['Default']);
});

test('failed recovery persistence preserves the previously published state', async () => {
    const { store, registry, saved } = await fixture();
    const before = registry.snapshot();
    saved.profiles.Work.pointer = -1;
    await store.save('registry', saved);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(true), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    store.save = save;
    await registry.load(true);
    assert.deepEqual(registry.profileSelection().profiles, ['Default']);
});
