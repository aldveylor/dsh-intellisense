import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { apply } from '../../src/integration/plugin.js';
import { apply as applyProfiles } from '../../src/profile/plugin.js';
import { snapshotVersion, storageVersion } from '../../src/storage/version.js';

test('startup loading failures keep management available and reset replaces obsolete Profile storage', async () => {
    const records: Record<string, unknown> = {
        registry: { version: storageVersion, revision: 3, mappings: [{ id: 'read', path: 'files.read', pinned: false }] },
        command_queries: { version: storageVersion, counts: { read: 4, broken: -1 } },
    };
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const descriptors: unknown[] = [];
    const warnings: unknown[] = [];
    const ctx = {
        storage: { backend: { get: () => ({ kv: { open: async (descriptor: unknown) => {
            descriptors.push(descriptor);
            return { loadAll: async () => ({ tables: { state: structuredClone(records) } }),
                putRecord: async (_table: string, key: string, value: unknown) => { records[key] = structuredClone(value); },
                deleteRecord: async (_table: string, key: string) => { delete records[key]; },
                close: async () => {},
            };
        } } }) } },
        connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => { routes.set(route.path, route.fetch); } } },
        logger: { warn: (...args: unknown[]) => { warnings.push(args); } },
        effect: () => {}, on: () => {}, emit: () => {}, get: () => undefined,
        agents: { list: () => [] }, tools: { schemas: () => [] },
        provide: (name: string, value: unknown) => { Object.assign(ctx, { [name]: value }); },
    } as unknown as Context;
    await applyProfiles(ctx);
    await apply(ctx);
    assert.equal(warnings.length, 1);
    assert.deepEqual(descriptors, [{ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1, 2, 3], tables: ['state'], hasGlobal: false, layout: 'per-record' }, { name: 'intellisense_profile_snapshots', version: snapshotVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' }]);
    const route = routes.get('/api/ts-intellisense-state')!;
    assert.equal((await route(new Request('https://localhost/api/ts-intellisense-state'))).status, 400);
    const response = await route(new Request('https://localhost/api/ts-intellisense-state', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover' }),
    }));
    assert.equal(response.status, 200, await response.text());
    const restored = await route(new Request('https://localhost/api/ts-intellisense-state'));
    assert.equal(restored.status, 200);
    const state = await restored.json();
    assert.deepEqual(state.state.mappings, []);
    assert.deepEqual(state.queriesByTool, { read: 4 });
    records.unrecognized_old_key = { invalid: true };
    records.profile_snapshot_journal = { invalid: true };
    records.profile_snapshot_sequence = 'broken';
    await ctx.intellisense.statistics.calls.increment('pending', ['discard_me']);
    const reset = await route(new Request('https://localhost/api/ts-intellisense-state', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover', full: true }),
    }));
    assert.equal(reset.status, 200, await reset.text());
    assert.equal(records.unrecognized_old_key, undefined);
    assert.equal(records.profile_snapshot_journal, undefined);
    assert.deepEqual(await ctx.intellisense.statistics.calls.snapshot(), {});
    assert.deepEqual(await ctx.intellisense.statistics.queries.snapshot(), {});
    assert.equal((await route(new Request('https://localhost/api/ts-intellisense-state'))).status, 200);
});

test('KV version upgrade retains compatible records for domain-level partial recovery', async () => {
    const { JsonStorageBackend } = await import('@deepseek-ai/dsh-storage-json');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DshStore } = await import('../../src/storage/store.js');
    const { SemanticRegistry } = await import('../../src/profile/catalog/registry.js');
    const { CommandStatistics } = await import('../../src/statistics/command_statistics.js');
    const directory = await mkdtemp(join(tmpdir(), 'intellisense-storage-'));
    const backend = new JsonStorageBackend(directory);
    try {
        const old = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
        await old.putRecord('state', 'registry', { version: 1, revision: 3, mappings: [{ id: 'read', path: 'files.read', pinned: false }, null] });
        await old.putRecord('state', 'command_queries', { counts: { read: 4 } });
        await old.close();
        const current = await backend.kv.open({ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' });
        const store = new DshStore(current);
        const registry = new SemanticRegistry(store);
        const statistics = new CommandStatistics(store);
        await assert.rejects(registry.load(), /Invalid Profile reference catalog/);
        await registry.load(true);
        await statistics.load();
        assert.equal(registry.snapshot().version, storageVersion);
        assert.deepEqual(registry.snapshot().mappings, []);
        assert.deepEqual((await statistics.queries.snapshot()), { read: 4 });
    } finally { await backend.close(); await rm(directory, { recursive: true, force: true }); }
});

test('version 3 catalogs and command-node archives survive a real KV upgrade', async () => {
    const { JsonStorageBackend } = await import('@deepseek-ai/dsh-storage-json');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DshStore } = await import('../../src/storage/store.js');
    const { SemanticRegistry } = await import('../../src/profile/catalog/registry.js');
    const directory = await mkdtemp(join(tmpdir(), 'intellisense-snapshot-'));
    const backend = new JsonStorageBackend(directory);
    try {
        const global = await backend.kv.open({ name: 'ts_intellisense', version: 3, tables: ['state'], hasGlobal: false, layout: 'per-record' });
        const root = { type: 'namespace', children: { read: { type: 'command', command: { tool: 'read_file', doc: 'Read a file' } } } };
        await global.putRecord('state', 'registry', { version: 3, revision: 7, profile: 'Work', profiles: { Work: { pointer: 1, root } } });
        await global.putRecord('state', 'profile_session_existing', { name: 'Work', pointer: 1 });
        await global.close();
        const obsolete = await backend.kv.open({ name: 'intellisense_profile_snapshots', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
        await obsolete.putRecord('state', 'profile_snapshot_1', { root });
        await obsolete.putRecord('state', 'profile_snapshot_sequence', 1);
        await obsolete.close();
        const unit = await backend.kv.open({ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1, 2, 3], tables: ['state'], hasGlobal: false, layout: 'per-record' });
        const snapshots = await backend.kv.open({ name: 'intellisense_profile_snapshots', version: snapshotVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' });
        const store = new DshStore(snapshots);
        assert.equal((await store.loadEntries('profile_snapshot_')).length, 2);
        const registry = new SemanticRegistry(new DshStore(unit), 'global', undefined, store);
        await registry.load();
        assert.deepEqual(registry.profileSelection(), { profiles: ['Work'], selected: 'Work' });
        const reference = await registry.reference('Work');
        assert.equal(reference.pointer, 1);
        assert.equal(reference.snapshot.resolve('read')?.type, 'function');
        assert.deepEqual((await registry.snapshots.get(1)).serialize(), reference.serialize());
        assert.deepEqual(await new DshStore(unit).load('profile_session_existing'), { name: 'Work', pointer: 1 });
        assert.equal((await new DshStore(unit).load<{ version: number }>('registry'))!.version, storageVersion);
        const restarted = new SemanticRegistry(new DshStore(unit), 'global', undefined, store);
        await restarted.load();
        assert.equal((await restarted.reference('Work')).pointer, 1);
    } finally { await backend.close(); await rm(directory, { recursive: true, force: true }); }
});

test('plugin teardown flushes delayed statistics before closing their storage backend', async () => {
    const records: Record<string, unknown> = {};
    const cleanup: Array<() => Promise<void>> = [];
    let closed = false;
    const ctx = {
        storage: { backend: { get: () => ({ kv: { open: async () => ({
            loadAll: async () => { assert(!closed); return { tables: { state: structuredClone(records) } }; },
            putRecord: async (_table: string, key: string, value: unknown) => { assert(!closed); records[key] = structuredClone(value); },
            deleteRecord: async (_table: string, key: string) => { assert(!closed); delete records[key]; },
            close: async () => { closed = true; },
        }) } }) } },
        connection: { fetch: { register: () => {} } },
        logger: { warn: () => {} },
        effect: (callback: () => () => Promise<void>) => { cleanup.push(callback()); },
        on: () => {}, emit: () => {}, get: () => undefined,
        agents: { list: () => [] }, tools: { schemas: () => [] },
        provide: (name: string, value: unknown) => { Object.assign(ctx, { [name]: value }); },
    } as unknown as Context;
    await applyProfiles(ctx);
    await apply(ctx);
    assert.strictEqual(ctx.intellisense.profiles, ctx.toolsNamespace);
    assert.strictEqual(ctx.intellisense.statistics, ctx.namespaceIntegration.statistics);
    assert.strictEqual(ctx.intellisense.inspectStatistics, ctx.namespaceIntegration.inspectStatistics);
    assert.strictEqual(ctx.intellisense.searchEngines, ctx.namespaceIntegration.searchEngines);
    await ctx.intellisense.statistics.calls.increment('last', ['read']);
    await ctx.intellisense.inspectStatistics.increment('Default', ['std.read']);
    assert.equal(records.command_calls, undefined);
    for (const dispose of cleanup.reverse()) await dispose();
    assert(closed);
    assert.equal((records.command_calls as unknown as { counts: { read: number } }).counts.read, 1);
    assert.equal(records.command_calls_journal, undefined);
    assert.deepEqual((records.inspect_statistics as { counts: Record<string, number> }).counts, { 'std.read': 1 });
});

test('repair retains valid siblings around obsolete builtin members and invalid member names', async () => {
    const { MemoryStore } = await import('../../src/storage/store.js');
    const { SemanticRegistry } = await import('../../src/profile/catalog/registry.js');
    const store = new MemoryStore();
    const snapshots = new MemoryStore();
    const registry = new SemanticRegistry(store, 'global', undefined, snapshots);
    const root = registry.definitions.createInitialProfile().serialize();
    root.children!.valid = { type: 'function', function: { tool: 'read_file' } };
    root.children!.tools!.children!.profile!.children!.obsolete = { type: 'function', function: { tool: 'old_tool' } };
    Object.defineProperty(root.children!, 'constructor', { value: { type: 'namespace' }, enumerable: true });
    await snapshots.save('profile_snapshot_sequence', 1);
    await snapshots.save('profile_snapshot_1', { root });
    await snapshots.save('profile_snapshot_unknown', {});
    await snapshots.save('profile_snapshot_journal', { version: 1, writes: [['foreign_key', {}]] });
    await store.save('registry', { version: storageVersion, revision: 7, profile: 'Work', profiles: { Work: { pointer: 1, root } },
        editor: { Work: { order: 'invalid' } } });
    await assert.rejects(registry.load());
    await registry.load(true);
    const reference = await registry.reference('Work');
    assert.equal(reference.snapshot.resolve('valid')?.type, 'function');
    assert.equal(reference.snapshot.resolve('tools.profile.obsolete'), undefined);
    assert.equal(reference.snapshot.resolve('tools.profile.load')?.type, 'function');
    assert.equal(reference.snapshot.resolve('constructor'), undefined);
    assert.equal((await registry.snapshots.get(1)).snapshot.resolve('valid')?.type, 'function');
    assert.equal(await snapshots.load('foreign_key'), undefined);
    assert.equal(await snapshots.load('profile_snapshot_unknown'), undefined);
    const reopened = new SemanticRegistry(store, 'global', undefined, snapshots);
    await reopened.load();
    assert.equal((await reopened.reference('Work')).snapshot.resolve('valid')?.type, 'function');
});
