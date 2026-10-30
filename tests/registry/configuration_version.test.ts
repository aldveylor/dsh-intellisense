import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type ProfileCatalogData } from '../../src/profile/catalog/registry.js';
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
    assert.equal(saved.profiles.Work!.brief, 'Work');
    assert.equal(typeof saved.profiles.Work!.pointer, 'number');
    assert.equal('name' in saved.profiles.Work!, false);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert.equal((await restored.reference('Work')).pointer, (await registry.reference('Work')).pointer);
});

test('unsupported configuration versions are rejected', async () => {
    const store = new MemoryStore();
    await store.save('registry', { version: storageVersion + 1, revision: 0, profile: 'Default', mappings: [] });
    await assert.rejects(new SemanticRegistry(store).load(), /Invalid Profile reference catalog/);
});

test('invalid current pointers are rejected and explicit recovery retains valid Profiles', async () => {
    const { store, saved } = await fixture();
    const expected = structuredClone(saved.profiles.Work!);
    saved.profiles.Work!.pointer = Number.MAX_SAFE_INTEGER;
    await store.save('registry', saved);
    const restored = new SemanticRegistry(store);
    await assert.rejects(restored.load(), /Invalid Profile reference/);
    await restored.load(true);
    assert.deepEqual(restored.profileSelection().profiles, ['Default', 'Work']);
    const recovered = await restored.reference('Work');
    assert(recovered.pointer > expected.pointer);
    assert.deepEqual(recovered.serialize(), { root: expected.root, brief: expected.brief });
    const restarted = new SemanticRegistry(store);
    await restarted.load();
    assert.equal((await restarted.reference('Work')).pointer, recovered.pointer);
});

test('failed recovery persistence preserves the previously published state', async () => {
    const { store, registry, saved } = await fixture();
    const before = registry.snapshot();
    const reference = await registry.reference('Work');
    saved.profiles.Work!.pointer = -1;
    await store.save('registry', saved);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(true), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    assert.equal((await registry.reference('Work')).pointer, reference.pointer);
    store.save = save;
    await registry.load(true);
    assert.deepEqual(registry.profileSelection().profiles, ['Default', 'Work']);
    const recovered = await registry.reference('Work');
    assert(recovered.pointer > reference.pointer);
    assert.deepEqual(recovered.serialize(), reference.serialize());
});

/** @brief Recreate command nodes from the schema 3 tree format, retaining all other fields. */
function legacyNodes(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    if (node.type === 'function') {
        const { function: command, ...properties } = node;
        return { ...properties, type: 'command', command };
    }
    return { ...node, ...(node.children ? { children: Object.fromEntries(Object.entries(node.children).map(([name, child]) => [name, legacyNodes(child)])) } : {}) };
}

for (const commands of [false, true]) {
    test(`schema 3 ${commands ? 'command' : 'function'} catalogs preserve Profiles, pointers and editor preferences`, async () => {
        const { store, registry, saved } = await fixture();
        saved.version = 3;
        if (commands) for (const value of Object.values(saved.profiles)) value.root = legacyNodes(value.root) as typeof value.root;
        await store.save('registry', saved);
        const restored = new SemanticRegistry(store);
        await restored.load();
        assert.deepEqual(restored.snapshot(), registry.snapshot());
        for (const name of registry.profileSelection().profiles) {
            assert.equal((await restored.reference(name)).pointer, (await registry.reference(name)).pointer);
            assert.deepEqual((await restored.reference(name)).serialize(), (await registry.reference(name)).serialize());
        }
        const upgraded = (await store.load<ProfileCatalogData>('registry'))!;
        assert.equal(upgraded.version, storageVersion);
        assert.deepEqual(upgraded.editor, saved.editor);
        const restarted = new SemanticRegistry(store);
        await restarted.load();
        assert.deepEqual(restarted.snapshot(), restored.snapshot());
    });
}

test('failed schema 3 conversion does not rewrite the catalog or publish partial state', async () => {
    const { store, registry, saved } = await fixture();
    const before = registry.snapshot();
    saved.version = 3;
    saved.profiles.Work!.root.children = { broken: { type: 'command', command: { tool: 42 } } } as never;
    await store.save('registry', saved);
    await assert.rejects(registry.load());
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(await store.load('registry'), saved);
});

test('schema 3 persistence failure preserves published state and can be retried', async () => {
    const { store, registry, saved } = await fixture();
    const before = registry.snapshot();
    saved.version = 3;
    await store.save('registry', saved);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    store.save = save;
    await registry.load();
    assert.equal((await store.load<ProfileCatalogData>('registry'))!.version, storageVersion);
});

for (const version of [1, 2]) {
    test(`schema ${version} follows adjacent upgrades and retains named flat Profiles`, async () => {
        const store = new MemoryStore();
        await store.save('registry', { version, revision: 12, profile: 'Work',
            mappings: [{ id: 'read_file', path: 'files.read', pinned: true, alwaysVisible: version === 1 ? true : 2,
                ...(version === 1 ? { enabled: false } : { disabled: true }) }],
            namespaces: [{ path: 'files', description: 'Files', alwaysVisible: true }],
            order: ['files', 'files.read'], toolComments: { read_file: 'Read files' },
            ...(version === 1 ? { unknownVisible: ['write_file'], builtinVisible: ['tools.search'] }
                : { unmountedVisible: { write_file: 2 }, builtinVisible: { 'tools.search': 2 } }),
            inactiveProfiles: { Other: { mappings: [{ id: 'write_file', path: 'files.write', pinned: false }] } },
        });
        const registry = new SemanticRegistry(store);
        await registry.load();
        assert.deepEqual(registry.profileSelection(), { profiles: ['Other', 'Work'], selected: 'Work' });
        assert.equal(registry.revision, 12);
        const configuration = registry.configuration();
        assert.equal(configuration.mappings.find(mapping => mapping.path === 'files.read')!.disabled, true);
        assert.equal(configuration.mappings.find(mapping => mapping.path === 'files.read')!.alwaysVisible, 2);
        assert.equal(configuration.mappings.find(mapping => mapping.path === 'files.read')!.pinned, true);
        assert.deepEqual(configuration.unmountedVisible, { write_file: 2 });
        assert.deepEqual(configuration.order, ['files', 'files.read']);
        assert.equal(configuration.toolComments.read_file, 'Read files');
        assert.equal(configuration.namespaces.find(namespace => namespace.path === 'files')!.description, 'Files');
        assert.equal((await registry.reference('Other')).snapshot.resolve('files.write')?.type, 'function');
        const saved = (await store.load<ProfileCatalogData>('registry'))!;
        assert.equal(saved.version, storageVersion);
        const restarted = new SemanticRegistry(store);
        await restarted.load();
        assert.deepEqual(restarted.snapshot(), registry.snapshot());
        assert.equal((await restarted.reference('Work')).pointer, (await registry.reference('Work')).pointer);
    });
}
