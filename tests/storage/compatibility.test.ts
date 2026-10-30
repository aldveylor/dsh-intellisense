import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type ProfileCatalogData } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { ImplToolsProfileNamespace } from '../../src/tools/profile_nodes/impl_tools_profile_namespace.js';
import { upgradeProfileNodes } from '../../src/storage/compatibility/profile_compatibility.js';
import { Statistics } from '../../src/statistics/statistics.js';
import { storageVersion } from '../../src/storage/version.js';
import type { ProfileData } from '../../src/profile/catalog/profile_tree.js';
import type { NamespaceTreeNode } from '../../src/profile/catalog/profile_node.js';

/** @brief Recreate the obsolete removal member in a persisted Profile tree. */
function oldRemoval(root: NamespaceTreeNode): void {
    const profile = root.children!.tools!.children!.profile!;
    profile.children!.delete = { ...profile.children!.remove!, disabled: true, fixedLevel: 2, function: { tool: 'tools_profile_delete' } };
    delete profile.children!.remove;
}

for (const version of [3, storageVersion]) test(`schema ${version} removal members are rewritten in catalog and history on read`, async () => {
    const store = new MemoryStore();
    const history = new MemoryStore();
    const registry = new SemanticRegistry(store, 'global', undefined, history);
    await registry.saveProfile('Work', registry.configuration());
    const reference = await registry.reference('Work');
    await registry.snapshots.archive(reference);
    const saved = (await store.load<ProfileCatalogData>('registry'))!;
    saved.version = version;
    oldRemoval(saved.profiles.Work!.root);
    const archived = reference.serialize();
    oldRemoval(archived.root);
    await store.save('registry', saved);
    const key = `profile_snapshot_${reference.pointer}`;
    await history.save(key, archived);

    const restored = new SemanticRegistry(store, 'global', undefined, history);
    await restored.load();
    const current = await restored.reference('Work');
    assert.equal(current.pointer, reference.pointer);
    assert.equal((await restored.snapshots.get(reference.pointer)).pointer, reference.pointer);
    for (const root of [current.snapshot.serialize(), (await store.load<ProfileCatalogData>('registry'))!.profiles.Work!.root,
        (await history.load<Pick<ProfileData, 'root' | 'brief'>>(key))!.root]) {
        const children = root.children!.tools!.children!.profile!.children!;
        assert.equal(Object.hasOwn(children, 'delete'), false);
        assert.equal(children.remove!.function!.tool, 'tools_profile_remove');
        assert.equal(children.remove!.disabled, true);
        assert.equal(children.remove!.fixedLevel, 2);
    }
    assert.equal((await store.load<ProfileCatalogData>('registry'))!.version, storageVersion);
    store.save = history.save = async () => { throw new Error('Unexpected rewrite of current storage'); };
    await new SemanticRegistry(store, 'global', undefined, history).load();
});

test('node conversion is scoped, retains current settings and handles old command nodes', () => {
    const profile = new ImplToolsProfileNamespace().serialize();
    const root: NamespaceTreeNode = { type: 'namespace', children: {
        tools: { type: 'namespace', children: { profile } },
        custom: { type: 'namespace', children: { delete: { type: 'function', function: { tool: 'tools_profile_delete' } } } },
    } };
    profile.children!.remove!.fixedLevel = 1;
    profile.children!.delete = { type: 'command', command: { tool: 'tools_profile_delete' } } as never;
    const original = structuredClone(root);
    const upgraded = upgradeProfileNodes(root) as NamespaceTreeNode;
    const children = upgraded.children!.tools!.children!.profile!.children!;
    assert.equal(Object.hasOwn(children, 'delete'), false);
    assert.equal(children.remove!.fixedLevel, 1);
    assert.deepEqual(upgraded.children!.custom, root.children!.custom);
    assert.deepEqual(root, original);
    delete profile.children!.remove;
    const converted = upgradeProfileNodes(root) as NamespaceTreeNode;
    assert.equal(converted.children!.tools!.children!.profile!.children!.remove!.type, 'function');
    assert.equal(converted.children!.tools!.children!.profile!.children!.remove!.function!.tool, 'tools_profile_remove');
    assert.throws(() => new ImplToolsProfileNamespace(profile), /Invalid builtin Profile member: delete/);
    assert.throws(() => new ImplToolsProfileNamespace().copyNode(profile), /Invalid builtin Profile member: delete/);
});

test('failed catalog rewrite retains published state and can be retried', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.saveProfile('Work', registry.configuration());
    const before = registry.snapshot();
    const saved = (await store.load<ProfileCatalogData>('registry'))!;
    oldRemoval(saved.profiles.Work!.root);
    await store.save('registry', saved);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(registry.load(), /Disk failed/);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(await store.load('registry'), saved);
    store.save = save;
    await registry.load();
    assert.equal(Object.hasOwn((await store.load<ProfileCatalogData>('registry'))!.profiles.Work!.root.children!.tools!.children!.profile!.children!, 'delete'), false);
});

test('statistics rewrite old checkpoints on read and leave current checkpoints unchanged', async () => {
    const store = new MemoryStore();
    await store.save('sample', { version: storageVersion - 1, counts: { read: 5, invalid: -1 } });
    const statistics = new Statistics(store, 'sample');
    await statistics.load();
    assert.deepEqual(await statistics.snapshot(), { read: 5 });
    assert.deepEqual(await store.load('sample'), { version: storageVersion, counts: { read: 5 } });
    store.save = async () => { throw new Error('Unexpected rewrite of current storage'); };
    await statistics.load();
    await statistics.dispose();
});

test('recovery upgrades valid current entries while discarding malformed catalog entries', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.saveProfile('Work', registry.configuration());
    const saved = (await store.load<ProfileCatalogData>('registry'))!;
    oldRemoval(saved.profiles.Work!.root);
    saved.profiles.Broken = null as never;
    await store.save('registry', saved);
    const restored = new SemanticRegistry(store);
    await restored.load(true);
    assert.deepEqual(restored.profileSelection().profiles, ['Default', 'Work']);
    assert.equal(Object.hasOwn((await store.load<ProfileCatalogData>('registry'))!.profiles.Work!.root.children!.tools!.children!.profile!.children!, 'delete'), false);
});

test('failed archived conversion is recovered through the journal before references are opened', async () => {
    const store = new MemoryStore();
    const history = new MemoryStore();
    const registry = new SemanticRegistry(store, 'global', undefined, history);
    await registry.saveProfile('Work', registry.configuration());
    const reference = await registry.reference('Work');
    const archived = reference.serialize();
    oldRemoval(archived.root);
    const key = `profile_snapshot_${reference.pointer}`;
    const saved = (await store.load<ProfileCatalogData>('registry'))!;
    saved.profiles.Work!.root = structuredClone(archived.root);
    await store.save('registry', saved);
    await history.save(key, archived);
    const save = history.save.bind(history);
    history.save = async (name, value) => {
        if (name === key) throw new Error('Archive write failed');
        await save(name, value);
    };
    const failed = new SemanticRegistry(store, 'global', undefined, history);
    await assert.rejects(failed.load(), /Archive write failed/);
    assert.deepEqual(await history.load(key), archived);
    history.save = save;
    const restored = new SemanticRegistry(store, 'global', undefined, history);
    await restored.load();
    const snapshot = await restored.snapshots.get(reference.pointer);
    assert.equal(snapshot.pointer, reference.pointer);
    assert.equal(snapshot.snapshot.resolve('tools.profile.delete'), undefined);
    assert.equal((await history.load<Pick<ProfileData, 'root' | 'brief'>>(key))!.root.children!.tools!.children!.profile!.children!.remove!.function!.tool, 'tools_profile_remove');
    assert.equal(await history.load('profile_snapshot_journal'), undefined);
});
