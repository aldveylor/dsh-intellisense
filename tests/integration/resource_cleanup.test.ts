import { namespace } from '../namespace/fixtures.js';
import { positionalArguments } from '../namespace/fixtures.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
import * as presetPlugin from '../../src/preset/index.js';
import type { KvUnit } from '@deepseek-ai/dsh-storage';
import { DshStore, MemoryStore } from '../../src/storage/store.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { declaration, type ManifestEntry } from '../../src/namespace/namespace.js';
import { nativeBindings } from '../../src/namespace/native_tools.js';
import { RuntimeHost } from '../../src/runtime/host.js';

test('optional Profile names are omitted and both save overloads retain the Profile', async () => {
    const entry: ManifestEntry = { path: 'tools.profile.save', tool: 'tools_profile_save', doc: 'Save', output: { type: 'null' },
        schema: { type: 'object', additionalProperties: false, required: ['profile'], properties: { name: { type: 'string' }, profile: { type: 'object' } } } };
    const profile = { root: { type: 'namespace', children: {} } };
    assert.deepEqual(await positionalArguments(entry, [undefined, profile]), { profile });
    assert.deepEqual(await positionalArguments(entry, [profile]), { profile });
    assert.deepEqual(await positionalArguments(entry, ['Copy', profile]), { name: 'Copy', profile });
    await assert.rejects(positionalArguments(entry, [3, profile]), /Invalid arguments/);
    assert.match(declaration(namespace([entry]).commands().find(node => node.path === entry.path)!), /function save\(profile: ProfileWrite\)/);
});

test('session edits overwrite one working record and release removes it without changing other sessions', async () => {
    const store = new MemoryStore();
    const records = new Map<string, unknown>();
    const save = store.save.bind(store), remove = store.remove.bind(store);
    store.save = async (key, value) => { records.set(key, value); await save(key, value); };
    store.remove = async key => { records.delete(key); await remove(key); };
    const catalog = new SemanticRegistry(store);
    const profiles = new ProfileSessions(catalog, store);
    const first = await profiles.forSession('first');
    const second = await profiles.forSession('second');
    for (let revision = 0; revision < 20; revision++) await first.configure([], revision, [], [], {}, undefined, {}, {}, { console: true });
    assert.equal(records.size, 1);
    assert.equal(second.snapshot().namespaceVisible?.console ?? false, false);
    assert.equal(catalog.snapshot().revision, 0);
    await profiles.release('first');
    assert.equal(records.size, 0);
    assert.equal((await profiles.forSession('first')).snapshot().revision, 0);
    await profiles.dispose();
});

test('DSH store observes external updates and deletes through the KV backend', async () => {
    const state: Record<string, unknown> = { value: 'before' };
    const unit = {
        loadAll: async () => ({ tables: { state }, global: null }),
        putRecord: async (_table: string, key: string, value: unknown) => { state[key] = value; },
        deleteRecord: async (_table: string, key: string) => { delete state[key]; },
    } as unknown as KvUnit;
    const store = new DshStore(unit);
    assert.equal(await store.load('value'), 'before');
    state.value = 'after';
    assert.equal(await store.load('value'), 'after');
    await store.remove('value');
    assert.equal(await store.load('value'), undefined);
});

test('long native names remain unique when their complete digest is already reserved', async () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({ path: `files.${'a'.repeat(100)}${index}`, tool: `physical_${index}`, doc: '', schema: {}, output: {} }) as ManifestEntry);
    const reserved = nativeBindings(namespace(entries).commands().filter(node => entries.some(entry => entry.path === node.path)), []).map(binding => binding.name);
    const rebound = nativeBindings(namespace(entries).commands().filter(node => entries.some(entry => entry.path === node.path)), reserved).map(binding => binding.name);
    assert.equal(new Set(rebound).size, entries.length);
    for (const name of rebound) { assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/); assert(!reserved.includes(name)); }
});

test('release during startup settles queued work and lets a later owner start cleanly', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const first = host.execute('owner', 'first', 'return 1;', [], async () => null, new AbortController().signal);
        const second = host.execute('owner', 'second', 'return 2;', [], async () => null, new AbortController().signal);
        const settled = Promise.allSettled([first, second]);
        await host.release('owner');
        assert((await settled).every(result => result.status === 'rejected'));
        assert.equal(host.epoch('owner'), 1);
        const resumed = await host.execute('owner', 'third', 'return 3;', [], async () => null, new AbortController().signal);
        assert.equal(resumed.value, 3);
        await host.release('owner');
        assert.equal(host.epoch('owner'), 1);
    } finally { await host.dispose(); }
});

test('management rejects malformed writes and requires an explicit complete save-as request', async () => {
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    const registry = new SemanticRegistry(new MemoryStore());
    registerManagement(ctx, registry, { refresh: async () => {} });
    const post = (body: string) => routes.get('/api/ts-intellisense-state')!(new Request('https://localhost/api/ts-intellisense-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
    const malformed = await post('{');
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'invalid_json_body' });
    const configuration = { revision: 0, mappings: [], namespaces: [], order: [], unmountedVisible: {}, builtinVisible: {}, namespaceVisible: {}, builtinDisabled: [], toolComments: {} };
    assert.equal((await post(JSON.stringify({ action: 'configure', profile: 'Copy', ...configuration }))).status, 400);
    assert.equal((await post(JSON.stringify({ action: 'save_as', profile: 'Copy', revision: 0 }))).status, 400);
    assert.equal(registry.snapshot().revision, 0);
    assert.equal((await post(JSON.stringify({ action: 'save_as', profile: 'Copy', ...configuration }))).status, 200);
    assert.equal(registry.snapshot().profile, 'Copy');
    assert.deepEqual(registry.snapshot().profiles, ['Copy', 'Default']);
});

test('shared preset capabilities retain independent native and PTC presentation modes', async () => {
    const presets: { id: string; plugins: { id: string; config?: unknown }[] }[] = [];
    const ctx = { agentPresets: { register: async (preset: typeof presets[number]) => { presets.push(preset); return async () => {}; } }, effect: () => {} } as unknown as Context;
    await presetPlugin.apply(ctx);
    assert.equal(presets.length, 2);
    for (const preset of presets) assert.deepEqual(preset.plugins.find(plugin => plugin.id === 'intellisense-presentation')?.config, { mode: preset.id === 'intellisense-ptc' ? 'ptc' : 'native' });
    const capabilities = (preset: typeof presets[number]) => preset.plugins.filter(plugin => plugin.id !== 'intellisense-presentation');
    assert.deepEqual(capabilities(presets[0]!), capabilities(presets[1]!));
});

test('preset component registers and releases presets with only the native registry service', async () => {
    const ctx = new Context();
    const presets = new Map<string, unknown>();
    try {
        ctx.provide('agentPresets', { register: async (preset: { id: string }) => {
            presets.set(preset.id, preset);
            return () => { presets.delete(preset.id); };
        } });
        const mounted = await ctx.plugin(presetPlugin);
        assert.deepEqual([...presets.keys()].sort(), ['intellisense', 'intellisense-ptc']);
        assert.equal(ctx.get('commandNamespaces'), undefined);
        assert.equal(ctx.get('codeRuntime'), undefined);
        await mounted.dispose();
        assert.equal(presets.size, 0);
    } finally { await ctx.fiber.dispose(); }
});

test('management reuses one tool projection until the registry contract changes', async () => {
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Read', parameters: {}, output: { type: 'string' } }]);
    const tools = registry.tools.bind(registry);
    let reads = 0;
    registry.tools = () => { reads++; return tools(); };
    registerManagement(ctx, registry, { refresh: async () => {} });
    const get = () => routes.get('/api/ts-intellisense-state')!(new Request('https://localhost/api/ts-intellisense-state'));
    const first = await (await get()).json();
    assert.equal(reads, 1);
    assert.equal(first.tools[0].outputDeclaration, 'string');
    assert.deepEqual(await (await get()).json(), first);
    assert.equal(reads, 1);
    registry.refresh([{ id: 'read', description: 'Updated', parameters: {}, output: { type: 'number' } }]);
    const updated = await (await get()).json();
    assert.equal(reads, 2);
    assert.equal(updated.tools[0].outputDeclaration, 'number');
    assert.equal(updated.tools[0].description, 'Updated');
});
