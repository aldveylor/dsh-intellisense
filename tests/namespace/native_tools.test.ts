import { namespace } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeBindings, nativeDiscovery } from '../../src/namespace/native_tools.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import type { ManifestEntry } from '../../src/namespace/namespace.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

test('native names satisfy API limits and avoid path and physical name collisions', () => {
    const paths = ['std.cwd', 'std__cwd', 'std.$cwd', 'std._24_cwd', 'std.' + 'a'.repeat(100)];
    const entries = paths.map(path => ({ path, tool: path, doc: '', schema: {}, output: {} }) as ManifestEntry);
    const reserved = ['ns_std__cwd', 'ns_std__cwd_1'];
    const names = nativeBindings(namespace(entries).commands().filter(node => entries.some(entry => entry.path === node.path)), reserved).map(binding => binding.name);
    assert.equal(new Set(names).size, paths.length);
    assert.equal(names[0], 'ns_std__cwd_2');
    for (const name of names) {
        assert.match(name, /^ns_[a-zA-Z0-9_-]{1,61}$/);
        assert(!reserved.includes(name));
    }
    assert.deepEqual(nativeBindings(namespace(entries).commands().filter(node => entries.some(entry => entry.path === node.path)), reserved).map(binding => binding.name), names);
});

test('native aliases publish callable names, preserve native arguments and revoke stale handlers', async () => {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: () => {}, on: () => {}, emit: () => {}, agents: { list: () => [] }, tools: {
        register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; },
    } } as unknown as Context;
    const store = new MemoryStore(), registry = new SemanticRegistry(store);
    const physical = [{ id: 'read_file', description: 'Read file\nFull file documentation.', parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }, output: { type: 'string' } }];
    registry.refresh(physical);
    await registry.configure([{ id: 'read_file', path: 'fs.read', pinned: false }], 0);
    const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), [{ path: 'fs.open', tool: 'read_file' }]);
    component.physical = () => physical;
    const agent = { id: 'native-test', ctx } as Agent;
    assert.deepEqual(await component.syncNative(agent), []);
    const discovery = JSON.parse(await component.discover(agent, ['fs.']));
    assert.deepEqual(discovery.members.map((item: { path: string }) => item.path).sort(), ['fs.open', 'fs.read']);
    assert(discovery.members.every((item: { brief: string }) => item.brief === 'Read file'));
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(definitions.size, 0);
    await component.discover(agent, ['fs', '', 'global.fs.', 'fs.read.']);
    assert.deepEqual(await component.syncNative(agent), []);
    const exact = JSON.parse(await component.discover(agent, ['global.fs.open']));
    assert.equal(exact.members[0].brief, 'Read file');
    assert.deepEqual(await component.syncNative(agent), ['ns_fs__open']);
    await component.discover(agent, ['fs.', 'fs.read']);
    const names = await component.syncNative(agent);
    assert.deepEqual(names, ['ns_fs__read', 'ns_fs__open']);
    assert.deepEqual(await component.syncNative(agent), names);
    assert.equal(definitions.size, 2);
    const prompt = await component.prompt(agent);
    assert.equal(prompt, '');
    const open = definitions.get('ns_fs__open')!;
    assert.equal(open.description, 'fs.open: Read file');
    assert.deepEqual(open.parameters, { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] });
    component.dispatch = async (_agent, entry, args) => ({ tool: entry.tool, args });
    const parent = { agent } as ToolRunContext;
    assert.deepEqual(await open.execute({ file: '/tmp/file' }, parent), { tool: 'read_file', args: { file: '/tmp/file' } });
    await assert.rejects(open.execute({ path: '/tmp/file' }, parent), /Invalid arguments/);
    physical.length = 0;
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(definitions.size, 0);
    assert(!definitions.has('ns_fs__open'), 'Unavailable tools are removed from the native registry');
    await component.release(agent.id);
});

test('native discovery shows original documentation only for exact functions', () => {
    const root = namespace([{ path: 'fs.read', tool: 'read_file', doc: 'Read file\nFull file documentation.', schema: {}, output: {} }]);
    for (const queries of [['fs.'], ['fs.read']]) {
        const discovery = JSON.parse(nativeDiscovery(queries, root, () => 'Profile brief'));
        assert.equal(discovery.members[0].brief, 'Profile brief');
        if (queries[0] === 'fs.read') assert.equal(discovery.members[0].description, 'Read file\nFull file documentation.');
        else assert(!JSON.stringify(discovery).includes('Full file documentation.'));
    }
});

test('native discovery omits empty namespace, command and Profile briefs', () => {
    const root = namespace([{ path: 'fs.read', tool: 'read_file', doc: '', schema: {}, output: {} }]);
    const roots = JSON.parse(nativeDiscovery([''], root));
    assert(!Object.hasOwn(roots.members.find((member: { path: string }) => member.path === 'fs'), 'brief'));
    for (const queries of [['fs.'], ['fs.read']]) {
        const discovery = JSON.parse(nativeDiscovery(queries, root));
        assert(!Object.hasOwn(discovery.members[0], 'brief'));
    }
    const documented = namespace([{ path: 'fs.read', tool: 'read_file', doc: 'Full documentation', schema: {}, output: {} }]);
    for (const brief of ['', '  \n ']) {
        const discovery = JSON.parse(nativeDiscovery(['fs.read'], documented, () => brief));
        assert(!Object.hasOwn(discovery.members[0], 'brief'));
    }
});

test('native discovery stays detailed when enabled and is revoked by command or namespace disablement', async () => {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: () => {}, on: () => {}, emit: () => {}, agents: { list: () => [] }, tools: {
        get: () => undefined,
        register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; },
    } } as unknown as Context;
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'tools_intellisense', description: '', parameters: {}, output: {} }]);
    const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, new MemoryStore()), []);
    component.registryFor = async () => registry;
    const agent = { id: 'discovery-disable', ctx } as Agent;
    for (const disabled of [[], ['tools.intellisense'], [], ['tools'], []]) {
        await registry.replaceConfiguration({ ...registry.configuration(), builtinVisible: {}, builtinDisabled: disabled }, 'Default');
        assert.deepEqual(await component.syncNative(agent), disabled.length ? [] : ['ns_tools__intellisense']);
        assert.equal(definitions.has('ns_tools__intellisense'), !disabled.length);
    }
});
