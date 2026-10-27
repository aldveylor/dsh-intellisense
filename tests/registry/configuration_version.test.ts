import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

const mapping = { id: 'read', path: 'files.read', pinned: false };

test('unversioned global settings preserve valid entries and persist schema version one', async () => {
    const store = new MemoryStore();
    await store.save('registry', {
        revision: 7, profile: 'Work', mappings: [mapping, { ...mapping, path: 'files.read.child' }, { id: 'broken' }],
        namespaces: [{ path: 'files', description: 'Files', alwaysVisible: true }, { path: 'files.read.child', description: '', alwaysVisible: false }],
        order: ['files', 42, 'files.read'],
        unmountedVisible: { good: 2, bad: true }, builtinVisible: { 'tools.search': 1, broken: 9 },
        namespaceVisible: { files: true, broken: 2 }, toolComments: { read: 'Read files', broken: null },
        builtinDisabled: ['tools.search', 'tools.intellisense', null],
        inactiveProfiles: {
            Other: { mappings: [{ ...mapping, path: 'other.read' }, null], namespaces: 'broken', unmountedVisible: { other: 1 } },
            Broken: null, Work: { mappings: [] }, constructor: { mappings: [] },
        },
    });
    const registry = new SemanticRegistry(store);
    await registry.load();
    const state = registry.snapshot();
    assert.equal(state.version, 1);
    assert.equal(state.revision, 7);
    assert.equal(state.profile, 'Work');
    assert.deepEqual(state.mappings, [mapping]);
    assert.deepEqual(state.namespaces, [{ path: 'files', description: 'Files', alwaysVisible: true }]);
    assert.deepEqual(state.order, ['files', 'files.read']);
    assert.deepEqual(state.unmountedVisible, { good: 2 });
    assert.deepEqual(state.builtinVisible, { 'tools.search': 1 });
    assert.deepEqual(state.namespaceVisible, { files: true });
    assert.deepEqual(state.toolComments, { read: 'Read files' });
    assert.deepEqual(state.builtinDisabled, ['tools.search', 'tools.intellisense']);
    assert.deepEqual(state.profiles, ['Broken', 'Other', 'Work']);
    assert.deepEqual(registry.configuration('Other').mappings, [{ ...mapping, path: 'other.read' }]);
    assert.deepEqual(registry.configuration('Broken').mappings, []);
    const persisted = await store.load<{ version: number }>('registry');
    assert.equal(persisted?.version, 1);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert.deepEqual(restored.snapshot(), state);
});

test('changed global versions recover malformed containers and metadata', async () => {
    for (const version of [0, 2]) {
        const store = new MemoryStore();
        await store.save('registry', { version, revision: 'bad', profile: '__proto__', mappings: null, inactiveProfiles: [] });
        const registry = new SemanticRegistry(store);
        await registry.load();
        assert.equal(registry.snapshot().version, 1);
        assert.equal(registry.snapshot().revision, 0);
        assert.equal(registry.snapshot().profile, 'Default');
        assert.deepEqual(registry.snapshot().mappings, []);
    }
});

test('current global version stays strict and does not rewrite valid snapshots', async () => {
    const store = new MemoryStore();
    await store.save('registry', { version: 1, revision: 0, mappings: [mapping] });
    store.save = async () => { throw new Error('Unexpected write'); };
    await new SemanticRegistry(store).load();
    store.load = async <T>() => ({ version: 1, revision: 0, mappings: [null] }) as T;
    await assert.rejects(new SemanticRegistry(store).load(), /Invalid mapping/);
});

test('failed migration persistence preserves the loaded in-memory configuration', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    const before = registry.snapshot();
    await store.save('registry', { mappings: [mapping] });
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(await store.load('registry'), { mappings: [mapping] });
});

test('session working snapshots do not run global version recovery', async () => {
    const store = new MemoryStore();
    store.load = async <T>() => ({ version: 0, revision: 0, mappings: [mapping] }) as T;
    store.save = async () => { throw new Error('Unexpected session write'); };
    const catalog = new SemanticRegistry(new MemoryStore());
    const sessions = new ProfileSessions(catalog, store);
    await assert.rejects(sessions.forSession('existing'), /Invalid registry snapshot/);
});
