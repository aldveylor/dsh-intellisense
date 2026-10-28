import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { apply } from '../../src/namespace/plugin.js';
import { storageVersion } from '../../src/storage/version.js';

test('startup loading failures keep management available and reset preserves valid portions', async () => {
    const records: Record<string, unknown> = {
        registry: { version: storageVersion, revision: 3, mappings: [{ id: 'read', path: 'files.read', pinned: false }] },
        command_statistics: { version: storageVersion, sessions: {}, queriesByTool: { read: 4, broken: -1 } },
    };
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const descriptors: unknown[] = [];
    const warnings: unknown[] = [];
    const ctx = {
        storage: { backend: { get: () => ({ kv: { open: async (descriptor: unknown) => {
            descriptors.push(descriptor);
            return { loadAll: async () => ({ tables: { state: structuredClone(records) } }),
                putRecord: async (_table: string, key: string, value: unknown) => { records[key] = structuredClone(value); },
                close: async () => {},
            };
        } } }) } },
        connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => { routes.set(route.path, route.fetch); } } },
        logger: { warn: (...args: unknown[]) => { warnings.push(args); } },
        effect: () => {}, on: () => {}, emit: () => {}, get: () => undefined,
        agents: { list: () => [] }, tools: { schemas: () => [] },
        provide: (name: string, value: unknown) => { Object.assign(ctx, { [name]: value }); },
    } as unknown as Context;
    await apply(ctx);
    assert.equal(warnings.length, 1);
    assert.deepEqual(descriptors, [{ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' }]);
    const route = routes.get('/api/ts-intellisense-state')!;
    assert.equal((await route(new Request('https://localhost/api/ts-intellisense-state'))).status, 400);
    const response = await route(new Request('https://localhost/api/ts-intellisense-state', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover' }),
    }));
    assert.equal(response.status, 200, await response.text());
    const restored = await route(new Request('https://localhost/api/ts-intellisense-state'));
    assert.equal(restored.status, 200);
    const state = await restored.json();
    assert.deepEqual(state.state.mappings, [{ id: 'read', path: 'files.read', pinned: false }]);
    assert.deepEqual(state.queriesByTool, { read: 4 });
});

test('KV version upgrade retains compatible records for domain-level partial recovery', async () => {
    const { JsonStorageBackend } = await import('@deepseek-ai/dsh-storage-json');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DshStore } = await import('../../src/storage/store.js');
    const { SemanticRegistry } = await import('../../src/registry/registry.js');
    const { CommandStatistics } = await import('../../src/namespace/statistics.js');
    const directory = await mkdtemp(join(tmpdir(), 'intellisense-storage-'));
    const backend = new JsonStorageBackend(directory);
    try {
        const old = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
        await old.putRecord('state', 'registry', { version: 1, revision: 3, mappings: [{ id: 'read', path: 'files.read', pinned: false }, null] });
        await old.putRecord('state', 'command_statistics', { sessions: {}, queriesByTool: { read: 4 } });
        await old.close();
        const current = await backend.kv.open({ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' });
        const store = new DshStore(current);
        const registry = new SemanticRegistry(store);
        const statistics = new CommandStatistics(store);
        await registry.load();
        await statistics.load();
        assert.equal(registry.snapshot().version, storageVersion);
        assert.deepEqual(registry.snapshot().mappings, [{ id: 'read', path: 'files.read', pinned: false }]);
        assert.deepEqual((await statistics.snapshot()).queriesByTool, { read: 4 });
    } finally { await backend.close(); await rm(directory, { recursive: true, force: true }); }
});
