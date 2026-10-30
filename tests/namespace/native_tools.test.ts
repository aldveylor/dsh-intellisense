import { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { NamespaceComponent } from '../../src/profile/component.js';
import { namespace } from './fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeBindings } from '../../src/profile/namespace/native_tools.js';
import { nativeDiscovery } from './fixtures.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import type { ManifestEntry } from '../../src/profile/namespace/namespace.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

test('native names satisfy API limits and avoid path and physical name collisions', () => {
    const paths = ['std.cwd', 'std__cwd', 'std.$cwd', 'std._24_cwd', 'std.' + 'a'.repeat(100)];
    const entries = paths.map(path => ({ path, tool: path, doc: '', schema: {}, output: {} }) as ManifestEntry);
    const reserved = ['ns_std__cwd', 'ns_std__cwd_1'];
    const names = nativeBindings(entries as import('../../src/profile/namespace/namespace.js').FunctionEntry[], reserved).map(binding => binding.name);
    assert.equal(new Set(names).size, paths.length);
    assert.equal(names[0], 'ns_std__cwd_2');
    for (const name of names) {
        assert.match(name, /^ns_[a-zA-Z0-9_-]{1,61}$/);
        assert(!reserved.includes(name));
    }
    assert.deepEqual(nativeBindings(entries as import('../../src/profile/namespace/namespace.js').FunctionEntry[], reserved).map(binding => binding.name), names);
});

test('native aliases publish callable names, preserve native arguments and revoke stale handlers', async () => {
    const definitions = new Map<string, ToolDefinition>();
    const changes: Array<() => void> = [];
    const ctx = { effect: () => {}, on: (event: string, callback: () => void) => { if (event === 'tools/change') changes.push(callback); },
        emit: (event: string) => { if (event === 'tools/change') changes.forEach(callback => callback()); }, agents: { list: () => [] }, tools: {
        register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; },
    } } as unknown as Context;
    const store = new MemoryStore(), registry = new SemanticRegistry(store);
    const physical = [{ id: 'read_file', description: 'Read file\nFull file documentation.', parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }, output: { type: 'string' } }];
    registry.refresh(physical);
    await registry.configure([{ id: 'read_file', path: 'fs.read', pinned: false }], 0);
    const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(new NamespaceComponent(new Context(), registry), store), [{ path: 'fs.open', tool: 'read_file' }]);
    component.physical = () => physical;
    const agent = { id: 'native-test', ctx, session: Session.create(SessionId('native-test')) } as Agent;
    assert.deepEqual(await component.syncNative(agent), []);
    const discovery = JSON.parse(await component.discover(agent, ['fs.']));
    assert.deepEqual(discovery.members.map((item: { path: string }) => item.path).sort(), ['fs.open', 'fs.read']);
    assert(discovery.members.every((item: { brief: string }) => item.brief === 'Read file'));
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(definitions.size, 0);
    await component.discover(agent, ['fs', '', 'global.fs.', 'fs.read.']);
    assert.deepEqual(await component.syncNative(agent), []);
    await assert.rejects(component.discover(agent, ['fs.open', 'fs.missing']), /Unknown command: fs.missing/);
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(await component.discover(agent, ['global.fs.open']), 'success');
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
    component.dispatchTool = async (_agent, tool, args) => ({ tool, args });
    const parent = { agent } as ToolRunContext;
    assert.deepEqual(await open.execute({ file: '/tmp/file' }, parent), { tool: 'read_file', args: { file: '/tmp/file' } });
    await assert.rejects(open.execute({ path: '/tmp/file' }, parent), /Invalid arguments/);
    physical.length = 0;
    ctx.emit('tools/change');
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(definitions.size, 0);
    assert(!definitions.has('ns_fs__open'), 'Unavailable tools are removed from the native registry');
    await component.release(agent.id);
});

test('native discovery returns briefs for namespaces and success for exact functions', () => {
    const root = namespace([{ path: 'fs.read', tool: 'read_file', doc: 'Read file\nFull file documentation.', schema: {}, output: {} }]);
    (root.profile.resolve('fs.read') as import('../../src/profile/function.js').ProfileFunction).setDescription('Profile brief');
    const discovery = JSON.parse(nativeDiscovery(['fs.'], root));
    assert.deepEqual(discovery.members, [{ path: 'fs.read', brief: 'Profile brief' }]);
    assert.equal(nativeDiscovery(['fs.read'], root), 'success');
});

test('native discovery omits empty namespace, command and Profile briefs', () => {
    const root = namespace([{ path: 'fs.read', tool: 'read_file', doc: '', schema: {}, output: {} }]);
    const roots = JSON.parse(nativeDiscovery([''], root));
    assert(!Object.hasOwn(roots.members.find((member: { path: string }) => member.path === 'fs'), 'brief'));
    for (const queries of [['fs.'], ['fs.', 'fs.read']]) {
        const discovery = JSON.parse(nativeDiscovery(queries, root));
        assert(!Object.hasOwn(discovery.members[0], 'brief'));
    }
    const documented = namespace([{ path: 'fs.read', tool: 'read_file', doc: 'Full documentation', schema: {}, output: {} }]);
    for (const brief of ['', '  \n ']) {
        (documented.profile.resolve('fs.read') as import('../../src/profile/function.js').ProfileFunction).setDescription(brief);
        const discovery = JSON.parse(nativeDiscovery(['fs.'], documented));
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
    registry.refresh([{ id: 'tools_inspect', description: '', parameters: {}, output: {} }]);
    const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(new NamespaceComponent(new Context(), registry), new MemoryStore()));
    component.physical = () => registry.tools();
    const agent = { id: 'discovery-disable', ctx, session: Session.create(SessionId('discovery-disable')) } as Agent;
    for (const disabled of [[], ['tools.inspect'], [], ['tools'], []]) {
        await registry.replaceConfiguration({ ...registry.configuration(), builtinVisible: {}, builtinDisabled: disabled }, 'Default');
        await component.profiles.load(agent.session, 'Default');
        assert.deepEqual(await component.syncNative(agent), disabled.length ? [] : ['ns_tools__inspect']);
        assert.equal(definitions.has('ns_tools__inspect'), !disabled.length);
    }
});


test('native brief pins publish JSON hints and become callable only after exact discovery', async () => {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: () => {}, on: () => {}, emit: () => {}, agents: { list: () => [] }, tools: {
        register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; },
    } } as unknown as Context;
    const store = new MemoryStore(), registry = new SemanticRegistry(store);
    registry.refresh([
        { id: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { file: { type: 'string' } } }, output: {} },
        { id: 'tools_profile_load', description: 'Load profile', parameters: {}, output: {} },
    ]);
    const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(new NamespaceComponent(new Context(), registry), store));
    component.physical = () => registry.tools();
    component.isPtc = () => false;
    const agent = { id: 'native-pins', ctx, session: Session.create(SessionId('native-pins')) } as Agent;
    for (const level of [0, 1, 2] as const) {
        await registry.replaceConfiguration({ ...registry.configuration(),
            mappings: [{ id: 'read_file', path: 'files.library.read', pinned: false, alwaysVisible: level, description: 'Custom brief' }],
            namespaces: [{ path: 'files', description: 'File operations', alwaysVisible: false }],
            builtinVisible: { 'tools.profile.load': level },
        }, 'Default');
        await component.profiles.load(agent.session, 'Default');
        const names = await component.syncNative(agent);
        assert.equal(names.includes('ns_files__library__read'), level === 2);
        assert.equal(names.includes('ns_tools__profile__load'), level === 2);
        const prompt = await component.prompt(agent);
        if (level !== 1) { assert.equal(prompt, ''); continue; }
        assert(!prompt.includes('```ts'));
        assert(!prompt.includes('Function'));
        const directory = JSON.parse(prompt.slice(prompt.indexOf('{')));
        assert.deepEqual(directory.members.find((member: { path: string }) => member.path === 'files.library.read'),
            { path: 'files.library.read', brief: 'Custom brief' });
        assert.deepEqual(directory.members.find((member: { path: string }) => member.path === 'files'),
            { path: 'files', brief: 'File operations', namespace: true });
        assert(directory.members.some((member: { path: string }) => member.path === 'tools.profile.load'));
        assert(!prompt.includes('parameters'));
    }
    await registry.replaceConfiguration({ ...registry.configuration(),
        mappings: registry.configuration().mappings.map(mapping => ({ ...mapping, alwaysVisible: 1 })),
        builtinVisible: {},
    }, 'Default');
    await component.profiles.load(agent.session, 'Default');
    await component.discover(agent, ['files.library.']);
    assert(!definitions.has('ns_files__library__read'));
    await component.discover(agent, ['files.library.read']);
    assert(definitions.has('ns_files__library__read'));
    assert.deepEqual(definitions.get('ns_files__library__read')!.parameters,
        { type: 'object', properties: { file: { type: 'string' } } });
    await registry.replaceConfiguration({ ...registry.configuration(),
        namespaces: [{ path: 'files', description: 'File operations', alwaysVisible: false, disabled: true }],
    }, 'Default');
    await component.profiles.load(agent.session, 'Default');
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(await component.prompt(agent), '');
    await component.release(agent.id);
});
