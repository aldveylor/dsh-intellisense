import { Context } from '@deepseek-ai/cordis';
import { NamespaceComponent } from '../../src/profile/component.js';
import { sessionFor } from './session_fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PlaneProfile, PlaneProfileState, SemanticRegistry } from '../../src/profile/catalog/registry.js';
import type { PlaneProfileStateData } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

test('configuration restoration and save detach nested settings in both directions', () => {
    const data = new PlaneProfile().save();
    data.mappings.push({ id: 'read', path: 'files.read', pinned: false, disabled: true, alwaysVisible: 2 });
    data.namespaces.push({ path: 'files', description: 'Files', alwaysVisible: true });
    const configuration = new PlaneProfile(data);
    data.mappings[0]!.path = 'changed.read';
    data.namespaces[0]!.description = 'Changed';
    assert.equal(configuration.mappings[0]!.path, 'files.read');
    assert.equal(configuration.namespaces[0]!.description, 'Files');
    const saved = configuration.save();
    assert.equal(Object.getPrototypeOf(saved), Object.prototype);
    const restored = new PlaneProfile(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored, configuration);
    saved.mappings[0]!.disabled = false;
    saved.builtinVisible!['tools.inspect'] = 0;
    assert.equal(configuration.mappings[0]!.disabled, true);
    assert.equal(configuration.builtinVisible['tools.inspect'], undefined);
    restored.namespaces[0]!.description = 'Restored';
    assert.equal(configuration.namespaces[0]!.description, 'Files');
});

test('registry snapshots restore archived configurations as independent classes', () => {
    const data = { ...new PlaneProfile().save(), version: 1, revision: 8, profile: 'Work', profiles: ['Other', 'Work'],
        inactiveProfiles: { Other: new PlaneProfile().save() } };
    const state = new PlaneProfileState(data);
    assert(state instanceof PlaneProfile);
    assert(state.inactiveProfiles!.Other instanceof PlaneProfile);
    data.profiles.push('Changed');
    data.inactiveProfiles.Other.order.push('changed');
    assert.deepEqual(state.profiles, ['Other', 'Work']);
    assert.deepEqual(state.inactiveProfiles!.Other!.order, []);
    const saved = state.save();
    assert.equal(Object.getPrototypeOf(saved.inactiveProfiles!.Other), Object.prototype);
    const restored = new PlaneProfileState(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored, state);
    saved.inactiveProfiles!.Other!.namespaces.push({ path: 'changed', description: '', alwaysVisible: false });
    assert.deepEqual(state.inactiveProfiles!.Other!.namespaces, []);
    assert.deepEqual(restored.inactiveProfiles!.Other!.namespaces, []);
});

test('catalog reads expose detached classes and storage contains plain data', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.saveProfile('Other', new PlaneProfile({ namespaces: [{ path: 'other', description: '', alwaysVisible: false }] }));
    const snapshot = registry.snapshot();
    const configuration = registry.configuration('Other');
    assert(snapshot instanceof PlaneProfileState);
    assert(configuration instanceof PlaneProfile);
    assert(!('inactiveProfiles' in snapshot));
    snapshot.mappings.push({ id: 'read', path: 'files.read', pinned: false });
    configuration.namespaces[0]!.path = 'changed';
    assert.deepEqual(registry.snapshot().mappings, []);
    assert.equal(registry.configuration('Other').namespaces[0]!.path, 'other');
    const persisted = await store.load<PlaneProfileStateData>('registry');
    assert.equal(Object.getPrototypeOf(persisted), Object.prototype);
    assert.equal(Object.getPrototypeOf((persisted as unknown as { profiles: Record<string, object> }).profiles.Other), Object.prototype);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert(restored.snapshot() instanceof PlaneProfileState);
    assert.deepEqual(restored.configuration('Other'), registry.configuration('Other'));
});

test('session persistence stores only a name and numeric pointer', async () => {
    const catalog = new SemanticRegistry(new MemoryStore());
    await catalog.saveProfile('Draft', new PlaneProfile({ namespaces: [{ path: 'draft', description: '', alwaysVisible: true }] }));
    const store = new MemoryStore();
    const profiles = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const session = await profiles.load(sessionFor(profiles, 'session'), 'Draft');
    const key = `profile_session_${createHash('sha256').update('session').digest('hex')}`;
    const persisted = await store.load<{ name: string; pointer: number }>(key);
    assert.deepEqual(persisted, { name: 'Draft', pointer: session.profile.pointer });
    const restoredProfiles = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const restored = await restoredProfiles.addition(sessionFor(restoredProfiles, 'session'));
    assert.equal(restored.profile.pointer, session.profile.pointer);
    await restoredProfiles.load(sessionFor(restoredProfiles, 'session'), 'Default');
    assert.equal(session.profile.snapshot.resolve('draft')?.type, 'namespace');
    assert.equal(restored.profile.snapshot.resolve('draft'), undefined);
});
