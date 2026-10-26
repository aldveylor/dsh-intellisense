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
    const parent = await profiles.load('parent', 'Work');
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
    const expected = parent.configuration();
    const child = await profiles.forSession('child', async () => parent);
    assert.equal(child.snapshot().profile, 'Work');
    assert.equal(child.snapshot().revision, 0);
    assert.deepEqual(child.configuration(), expected);
    await profiles.load('parent', 'Default');
    assert.deepEqual(child.configuration(), expected);
    await child.replaceConfiguration({ ...child.configuration(), namespaces: [] }, 'Child');
    assert.equal(parent.snapshot().profile, 'Default');
    assert.equal(catalog.snapshot().profile, 'Default');
    assert.equal(catalog.configuration('Work').namespaces[0]?.path, 'saved');
    assert.equal((await profiles.forSession('root')).snapshot().profile, 'Default');
    assert.strictEqual(await profiles.forSession('child', async () => { throw new Error('Must not inherit twice'); }), child);
    await profiles.dispose();
});

test('persisted child working copies take priority over a changed parent when restored', async () => {
    const { catalog, store, profiles, parent } = await fixture();
    const child = await profiles.forSession('child', async () => parent);
    await child.replaceConfiguration({ ...child.configuration(), namespaces: [{ path: 'child', description: '', alwaysVisible: false }] }, 'Child');
    const expected = child.configuration();
    const restored = new ProfileSessions(catalog, store);
    const own = await restored.forSession('child', async () => { throw new Error('Saved child must not resolve its parent'); });
    assert.equal(own.snapshot().profile, 'Child');
    assert.deepEqual(own.configuration(), expected);
    await profiles.dispose();
    await restored.dispose();
});
