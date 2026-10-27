import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RegistryConfiguration, RegistryState, SemanticRegistry } from '../../src/registry/registry.js';
import type { RegistryStateData } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

test('configuration restoration and save detach nested settings in both directions', () => {
    const data = new RegistryConfiguration().save();
    data.mappings.push({ id: 'read', path: 'files.read', pinned: false, disabled: true, alwaysVisible: 2 });
    data.namespaces.push({ path: 'files', description: 'Files', alwaysVisible: true });
    const configuration = new RegistryConfiguration(data);
    data.mappings[0]!.path = 'changed.read';
    data.namespaces[0]!.description = 'Changed';
    assert.equal(configuration.mappings[0]!.path, 'files.read');
    assert.equal(configuration.namespaces[0]!.description, 'Files');
    const saved = configuration.save();
    assert.equal(Object.getPrototypeOf(saved), Object.prototype);
    const restored = new RegistryConfiguration(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored, configuration);
    saved.mappings[0]!.disabled = false;
    saved.builtinVisible!['tools.inspect'] = 0;
    assert.equal(configuration.mappings[0]!.disabled, true);
    assert.equal(configuration.builtinVisible['tools.inspect'], 2);
    restored.namespaces[0]!.description = 'Restored';
    assert.equal(configuration.namespaces[0]!.description, 'Files');
});

test('registry snapshots restore archived configurations as independent classes', () => {
    const data = { ...new RegistryConfiguration().save(), version: 1, revision: 8, profile: 'Work', profiles: ['Other', 'Work'],
        inactiveProfiles: { Other: new RegistryConfiguration().save() } };
    const state = new RegistryState(data);
    assert(state instanceof RegistryConfiguration);
    assert(state.inactiveProfiles!.Other instanceof RegistryConfiguration);
    data.profiles.push('Changed');
    data.inactiveProfiles.Other.order.push('changed');
    assert.deepEqual(state.profiles, ['Other', 'Work']);
    assert.deepEqual(state.inactiveProfiles!.Other!.order, []);
    const saved = state.save();
    assert.equal(Object.getPrototypeOf(saved.inactiveProfiles!.Other), Object.prototype);
    const restored = new RegistryState(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored, state);
    saved.inactiveProfiles!.Other!.namespaces.push({ path: 'changed', description: '', alwaysVisible: false });
    assert.deepEqual(state.inactiveProfiles!.Other!.namespaces, []);
    assert.deepEqual(restored.inactiveProfiles!.Other!.namespaces, []);
});

test('catalog reads expose detached classes and storage contains plain data', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.saveProfile('Other', new RegistryConfiguration({ namespaces: [{ path: 'other', description: '', alwaysVisible: false }] }));
    const snapshot = registry.snapshot();
    const configuration = registry.configuration('Other');
    assert(snapshot instanceof RegistryState);
    assert(configuration instanceof RegistryConfiguration);
    assert(!('inactiveProfiles' in snapshot));
    snapshot.mappings.push({ id: 'read', path: 'files.read', pinned: false });
    configuration.namespaces[0]!.path = 'changed';
    assert.deepEqual(registry.snapshot().mappings, []);
    assert.equal(registry.configuration('Other').namespaces[0]!.path, 'other');
    const persisted = await store.load<RegistryStateData>('registry');
    assert.equal(Object.getPrototypeOf(persisted), Object.prototype);
    assert.equal(Object.getPrototypeOf(persisted!.inactiveProfiles!.Other), Object.prototype);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert(restored.snapshot() instanceof RegistryState);
    assert.deepEqual(restored.configuration('Other'), registry.configuration('Other'));
});

test('session snapshots persist plain data and restore classes without sharing catalog state', async () => {
    const catalog = new SemanticRegistry(new MemoryStore());
    const store = new MemoryStore();
    const profiles = new ProfileSessions(catalog, store);
    const session = await profiles.forSession('session');
    await session.replaceConfiguration(new RegistryConfiguration({ namespaces: [{ path: 'draft', description: '', alwaysVisible: true }] }), 'Draft');
    const key = `profile_session_${createHash('sha256').update('session').digest('hex')}`;
    const persisted = await store.load<RegistryStateData>(key);
    assert.equal(Object.getPrototypeOf(persisted), Object.prototype);
    assert.equal(persisted!.profile, 'Draft');
    const restoredProfiles = new ProfileSessions(catalog, store);
    try {
        const restored = await restoredProfiles.forSession('session');
        assert(restored.snapshot() instanceof RegistryState);
        assert(restored.configuration() instanceof RegistryConfiguration);
        assert.deepEqual(restored.configuration(), session.configuration());
        await restored.replaceConfiguration(new RegistryConfiguration(), 'Default');
        assert.equal(session.configuration().namespaces[0]!.path, 'draft');
        assert.deepEqual(catalog.configuration().namespaces, []);
    } finally {
        await profiles.dispose();
        await restoredProfiles.dispose();
    }
    assert.equal(await store.load(key), undefined);
});
