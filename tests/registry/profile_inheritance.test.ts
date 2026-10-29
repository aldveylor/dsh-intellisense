import { sessionFor } from './session_fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Create a parent working copy that differs from both the catalog default and its saved profile. */
async function fixture() {
    const catalog = new SemanticRegistry(new MemoryStore());
    await catalog.saveProfile('Work', { ...catalog.configuration(), namespaces: [{ path: 'saved', description: '', alwaysVisible: false }] });
    const store = new MemoryStore();
    const profiles = new ProfileSessions(catalog, store);
    const parent = await profiles.load(sessionFor(profiles, 'parent'), 'Work');
    await parent.replaceConfiguration({
        ...parent.configuration(),
        mappings: [{ id: 'read', path: 'draft.read', pinned: true, alwaysVisible: 2, disabled: true }, { id: 'read', path: 'draft.again', pinned: true, alwaysVisible: 2, disabled: true }],
        namespaces: [{ path: 'draft', description: 'Unsaved namespace', alwaysVisible: true }],
        unmountedVisible: { other: 1 }, builtinVisible: { 'tools.search': 2 }, builtinDisabled: ['tools.search'],
        namespaceVisible: { draft: true }, toolComments: { read: 'Unsaved annotation' },
    }, 'Work');
    return { catalog, store, profiles, parent };
}

test('children inherit the complete working snapshot and detach subsequent changes', async () => {
    const { catalog, profiles, parent } = await fixture();
    const expected = (await profiles.addition(sessionFor(profiles, 'parent'))).profile.serialize();
    const child = await profiles.forSession(sessionFor(profiles, 'child'), async () => parent);
    assert.equal(child.snapshot().profile, 'Work');
    assert.equal(child.snapshot().revision, 0);
    assert.deepEqual((await profiles.addition(sessionFor(profiles, 'child'))).profile.serialize(), expected);
    await profiles.load(sessionFor(profiles, 'parent'), 'Default');
    assert.deepEqual((await profiles.addition(sessionFor(profiles, 'child'))).profile.serialize(), expected);
    await child.replaceConfiguration({ ...child.configuration(), namespaces: [] }, 'Child');
    assert.equal(parent.snapshot().profile, 'Default');
    assert.equal(catalog.snapshot().profile, 'Default');
    assert.equal(catalog.configuration('Work').namespaces[0]?.path, 'saved');
    assert.equal((await profiles.forSession(sessionFor(profiles, 'root'))).snapshot().profile, 'Default');
    assert.strictEqual(await profiles.forSession(sessionFor(profiles, 'child'), async () => { throw new Error('Must not inherit twice'); }), child);
});

test('persisted child working copies take priority over a changed parent when restored', async () => {
    const { catalog, store, profiles, parent } = await fixture();
    const child = await profiles.forSession(sessionFor(profiles, 'child'), async () => parent);
    await child.replaceConfiguration({ ...child.configuration(), namespaces: [{ path: 'child', description: '', alwaysVisible: false }] }, 'Child');
    const expected = (await profiles.addition(sessionFor(profiles, 'child'))).profile.serialize();
    const restored = new ProfileSessions(catalog, store);
    const own = await restored.forSession(sessionFor(restored, 'child'), async () => { throw new Error('Saved child must not resolve its parent'); });
    assert.equal(own.snapshot().profile, 'Child');
    assert.deepEqual((await restored.addition(sessionFor(restored, 'child'))).profile.serialize(), expected);
    await profiles.statistics.dispose();
});


test('session additions contain a snapshot and call statistics while edits synchronize internal projections', async () => {
    const { catalog, store, profiles } = await fixture();
    const addition = await profiles.addition(sessionFor(profiles, 'parent'));
    assert.deepEqual(Object.keys(addition).sort(), ['profile', 'save', 'statistics']);
    assert.equal(addition.profile.resolve('draft.read'), undefined);
    await addition.statistics.increment(['read']);
    assert.equal((await profiles.statistics.calls.snapshot('parent')).read, 1);
    assert.deepEqual(Object.keys(addition.statistics).sort(), ['increment', 'snapshot']);
    addition.profile.setBrief('Direct snapshot edit');
    const projected = await profiles.forSession(sessionFor(profiles, 'parent'));
    assert.equal(projected.configuration().brief, 'Direct snapshot edit');
    const restored = new ProfileSessions(catalog, store);
    assert.equal((await restored.addition(sessionFor(restored, 'parent'))).profile.brief, 'Direct snapshot edit');
    assert.deepEqual(Object.keys(await restored.addition(sessionFor(restored, 'parent'))).sort(), ['profile', 'save', 'statistics']);
    await profiles.statistics.dispose();
});


test('live session fields share initialization and explicit saves restore only the session snapshot', async () => {
    const { catalog, store, profiles } = await fixture();
    const session = sessionFor(profiles, 'external');
    const before = catalog.snapshot().save();
    const [addition, concurrent] = await Promise.all([profiles.addition(session), profiles.addition(session)]);
    assert.strictEqual(addition, concurrent);
    assert.strictEqual(session.intellisense, addition);
    addition.profile.setBrief('External edit');
    await addition.save();
    await catalog.manageProfile('select', 'Work', catalog.revision);
    const catalogBeforeRestore = catalog.snapshot().save();
    const restoredProfiles = new ProfileSessions(catalog, store);
    const restoredSession = sessionFor(restoredProfiles, 'external');
    const restored = await restoredProfiles.addition(restoredSession);
    assert.notStrictEqual(restoredSession, session);
    assert.notStrictEqual(restored.profile, addition.profile);
    assert.equal(restored.profile.brief, 'External edit');
    await restoredProfiles.forSession(restoredSession);
    assert.deepEqual(catalog.snapshot().save(), catalogBeforeRestore);
    assert.equal(catalog.configuration('Default').brief, before.brief);
    await profiles.statistics.dispose();
});

test('initial session snapshots persist and failed initialization can be retried', async () => {
    const catalog = new SemanticRegistry(new MemoryStore());
    const store = new MemoryStore();
    const profiles = new ProfileSessions(catalog, store);
    const session = sessionFor(profiles, 'initial');
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(profiles.addition(session), /Disk failed/);
    assert.equal(session.intellisense, undefined);
    store.save = save;
    const addition = await profiles.addition(session);
    await catalog.saveProfile('Work', catalog.configuration());
    await catalog.manageProfile('select', 'Work', catalog.revision);
    const restoredProfiles = new ProfileSessions(catalog, store);
    const restored = await restoredProfiles.forSession(sessionFor(restoredProfiles, 'initial'));
    assert.equal(restored.profileSelection().selected, 'Default');
    assert.deepEqual((await restoredProfiles.addition(sessionFor(restoredProfiles, 'initial'))).profile.serialize(), addition.profile.serialize());
});
