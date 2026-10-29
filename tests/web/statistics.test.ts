import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { Statistics } from '../../src/statistics/statistics.js';
import { CommandStatistics } from '../../src/statistics/command_statistics.js';
import { registerManagement } from '../../src/web/server/routes.js';

test('management reads selected Profile paths while sharing tool counters', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.load();
    const first = registry.profileSelection().selected;
    await registry.manageProfile('create', 'Other', registry.revision);
    const statistics = new CommandStatistics(store);
    const inspectStatistics = new Statistics(store, 'inspect_statistics');
    await statistics.calls.increment('session', ['read']);
    await statistics.queries.increment('session', ['read', 'read']);
    await inspectStatistics.increment(first, ['std', 'std.read']);
    await inspectStatistics.increment('Other', ['std', 'std', 'files.read']);
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } } } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {}, statistics, inspectStatistics });
    const route = routes.get('/api/ts-intellisense-state')!;
    for (const [name, expected] of [[first, { std: 1, 'std.read': 1 }], ['Other', { std: 2, 'files.read': 1 }]] as const) {
        const response = await route(new Request(`https://localhost/api/ts-intellisense-state?profile=${encodeURIComponent(name)}`));
        assert.equal(response.status, 200);
        const state = await response.json();
        assert.deepEqual(state.callsByTool, { read: 1 });
        assert.deepEqual(state.queriesByTool, { read: 2 });
        assert.deepEqual(state.queriesByPath, expected);
    }
    await statistics.dispose();
    await inspectStatistics.dispose();
});
