import { Context } from '@deepseek-ai/cordis';
import { NamespaceComponent } from '../../src/profile/component.js';
import { sessionFor } from './session_fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Publish a saved Profile and retain one immutable parent reference. */
async function fixture() {
    const catalog = new SemanticRegistry(new MemoryStore());
    await catalog.saveProfile('Work', { ...catalog.configuration(), namespaces: [{ path: 'saved', description: '', alwaysVisible: false }] });
    const store = new MemoryStore();
    const profiles = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const parent = await profiles.load(sessionFor(profiles, 'parent'), 'Work');
    return { catalog, store, profiles, parent };
}

test('children inherit their parent pointer and later switches stay independent', async () => {
    const { catalog, profiles, parent } = await fixture();
    const child = await profiles.addition(sessionFor(profiles, 'child'), async () => parent);
    assert.equal(child.name, 'Work');
    assert.equal(child.profile, parent.profile);
    const original = child.profile;
    await catalog.saveProfile('Work', { ...catalog.configuration('Work'), brief: 'Updated globally' });
    assert.equal(child.profile, original);
    await profiles.load(sessionFor(profiles, 'parent'), 'Default');
    assert.equal(parent.name, 'Default');
    assert.equal(child.name, 'Work');
    assert.equal(child.profile, original);
    assert.equal((await profiles.addition(sessionFor(profiles, 'root'))).name, 'Default');
});

test('restored child pointers take priority over a parent that has switched', async () => {
    const { catalog, store, profiles, parent } = await fixture();
    const child = await profiles.addition(sessionFor(profiles, 'child'), async () => parent);
    const pointer = child.profile.pointer;
    await profiles.load(sessionFor(profiles, 'parent'), 'Default');
    const restored = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const own = await restored.addition(sessionFor(restored, 'child'), async () => parent);
    assert.equal(own.name, 'Work');
    assert.equal(own.profile.pointer, pointer);
});

test('live session initialization is shared and save persists only the immutable pointer', async () => {
    const { store, profiles } = await fixture();
    const live = sessionFor(profiles, 'parallel');
    const [first, second] = await Promise.all([profiles.addition(live), profiles.addition(live)]);
    assert.equal(first, second);
    assert.equal(live.intellisense, first);
    const reference = first.profile;
    await first.save();
    assert.equal(first.profile, reference);
    assert.equal('registry' in first, false);
    const records = await store.loadEntries<{ pointer: number; name: string }>('profile_session_');
    assert(records.every(([, value]) => typeof value.pointer === 'number' && !Object.hasOwn(value, 'root')));
});

test('failed initialization remains unpublished and can be retried', async () => {
    const { store, profiles } = await fixture();
    const live = sessionFor(profiles, 'failed');
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Unavailable'); };
    await assert.rejects(profiles.addition(live), /Unavailable/);
    assert.equal(live.intellisense, undefined);
    store.save = save;
    assert.equal((await profiles.addition(live)).name, 'Default');
});
