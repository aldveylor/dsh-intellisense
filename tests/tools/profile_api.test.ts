import { namespace, positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { Profile, ProfileSchema, profileAnnotation, profileTree } from '../../src/registry/profile_tree.js';
import { MemoryStore } from '../../src/storage/store.js';
import { registerToolCommands } from '../../src/tools/tool_commands.js';
import { manifest } from '../../src/namespace/namespace.js';
import { nodePermissions } from '../../src/namespace/node.js';
import { inspect } from '../../src/tools/inspect.js';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { RuntimeHost } from '../../src/runtime/host.js';

/** @brief Exercise native command handlers using a real catalog and session references. */
async function fixture() {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: (work: () => unknown) => work(), tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => {}; } } } as unknown as Context;
    const catalog = new SemanticRegistry(new MemoryStore());
    const physical = { id: 'read_file', description: 'Read a file.', parameters: { type: 'object' }, output: { type: 'string' } };
    catalog.refresh([physical]);
    const profiles = new ProfileSessions(catalog, new MemoryStore());
    const registry = await profiles.forSession('session');
    registry.refresh([physical]);
    const changed: string[] = [];
    registerToolCommands(ctx, catalog, profiles, async () => registry, async agent => { changed.push(agent.id); }, async () => [{ name: physical.id, brief: physical.description, paths: ['files.read', 'files.cat'], totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', paths: [], totalCalls: 0 }]);
    const agentContext = new Context();
    agentContext.provide('commandNamespaces', { isPtc: () => true } as unknown as Context['commandNamespaces']);
    const execution = { agent: { id: 'session', inject: () => {}, ctx: agentContext, session: Session.create(SessionId('session')) }, signal: new AbortController().signal } as unknown as ToolRunContext;
    const call = (name: string, args: unknown = {}) => definitions.get(name)!.execute(args, execution);
    const load = async (args: unknown = {}) => ProfileSchema.parse(await call('tools_profile_load', args));
    return { definitions, registry, catalog, call, load, changed };
}

test('native Profile data tools and optional-name save/load use session defaults', async () => {
    const { definitions, call, registry, catalog } = await fixture();
    assert.deepEqual([...definitions.keys()].sort(), ['tools_profile_annotation', 'tools_profile_apply', 'tools_profile_commands', 'tools_profile_delete', 'tools_profile_load', 'tools_profile_profiles', 'tools_profile_save', 'tools_profile_setdefault', 'tools_profile_switch']);
    assert.equal(await call('tools_profile_annotation'), profileAnnotation);
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Default'], selected: 'Default' });
    assert.deepEqual(await call('tools_profile_commands'), [{ name: 'read_file', brief: 'Read a file.', paths: ['files.read', 'files.cat'], totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', paths: [], totalCalls: 0 }]);
    const profile = JSON.parse(JSON.stringify(profileTree('Ignored', { ...registry.configuration(), namespaces: [{ path: 'files', description: '', alwaysVisible: true }], mappings: [{ id: 'read_file', path: 'files.read', pinned: false, alwaysVisible: 2 }], toolComments: { read_file: 'Read text' } }))); 
    const before = registry.snapshot();
    await call('tools_profile_save', { profile });
    assert.deepEqual(registry.snapshot(), before);
    const savedProfile = structuredClone(profile);
    savedProfile.root.children['tools'].disabled = true;
    assert.deepEqual(JSON.parse(JSON.stringify(profileTree('Default', catalog.configuration('Default')))), { ...savedProfile, name: 'Default' });
    await call('tools_profile_save', { name: 'Copy', profile });
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Copy', 'Default'], selected: 'Default' });
    await call('tools_profile_switch', { name: 'Copy' });
    assert.deepEqual(JSON.parse(JSON.stringify(await call('tools_profile_load'))), { ...savedProfile, name: 'Copy' });
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Copy', 'Default'], selected: 'Copy' });
    await call('tools_profile_load', { name: 'Default' });
    assert.equal(registry.snapshot().profile, 'Copy');
});

test('manifest exposes only the new tools API and projects VM array arguments', async () => {
    const { definitions, registry } = await fixture();
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema } )).concat([
        { id: 'tools_inspect', description: 'Inspect commands.', parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] }, output: { type: 'string' } },
        { id: 'tools_mount', description: 'Old command.', parameters: {}, output: {} },
    ]));
    const entries = manifest(registry, []);
    assert.deepEqual(entries.commands().map(entry => entry.path).sort(), ['tools.inspect', 'tools.profile.annotation', 'tools.profile.apply', 'tools.profile.commands', 'tools.profile.delete', 'tools.profile.load', 'tools.profile.profiles', 'tools.profile.save', 'tools.profile.setdefault', 'tools.profile.switch']);
    const discovery = entries.commands().find(entry => entry.path === 'tools.inspect')!;
    assert.deepEqual(await positionalArguments(discovery, [['files.']]), { queries: ['files.'] });
    await assert.rejects(positionalArguments(discovery, ['files.']));
    assert.deepEqual(await positionalArguments(entries.commands().find(entry => entry.path === 'tools.profile.save')!, [{ name: 'Default', root: {} }]), { profile: { name: 'Default', root: {} } });
    const vm = inspect(['tools.profile.', 'tools.profile.save', 'tools.profile.apply', 'tools.inspect'], entries, true);
    assert(vm.includes('readonly annotation: string'));
    assert(vm.includes('readonly profiles: Profiles'));
    assert(vm.includes('save(profile: Profile)'));
    assert(vm.includes('apply(value: object)'));
    const apply = entries.commands().find(entry => entry.path === 'tools.profile.apply')!;
    assert.deepEqual(await positionalArguments(apply, [{ brief: null }]), { value: { brief: null } });
    assert.deepEqual(await positionalArguments(apply, [undefined, { brief: 'Draft' }]), { value: { brief: 'Draft' } });
    assert.deepEqual(await positionalArguments(apply, ['Copy', { root: {} }]), { name: 'Copy', value: { root: {} } });
    assert(vm.includes('function inspect(queries: string[])'));
    const native = inspect(['tools.profile.annotation'], entries, false);
    assert(native.includes('function annotation()'));
    for (const source of [vm, native]) {
        const file = ts.createSourceFile('api.d.ts', source, ts.ScriptTarget.Latest, true);
        assert.equal((file as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics.length, 0);
    }
});

test('guest constants preload as frozen data before execution', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const calls: unknown[] = [];
        const result = await host.execute('profile', 'one', `
            return [tools.profile.annotation,tools.profile.commands[0].name,
                Object.isFrozen(tools.profile.commands[0]),Object.getPrototypeOf(files.read) === null];`, [namespace([{ path: 'files.read', tool: 'read_file', doc: '', schema: {}, output: {} }]).commands().find(node => node.path === 'files.read')!.binding()], async (path, args) => { calls.push([path, args]); return true; }, new AbortController().signal,
        { 'tools.profile.annotation': 'declarations', 'tools.profile.commands': [{ name: 'read_file', brief: 'Read a file.' }] });
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, ['declarations', 'read_file', true, true]);
        assert.deepEqual(calls, []);
    } finally { await host.dispose(); }
});


test('guest Profile selection is readonly and refreshes after calls in the same execution', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const result = await host.execute('profiles', 'one', `
            const state = tools.profile.profiles;
            const before = JSON.stringify(state);
            let readonly = false;
            try { state.selected = 'Invalid'; } catch { readonly = true; }
            await files.read();
            return [before, state.selected, state.profiles, readonly,
                Object.isFrozen(state), Object.isFrozen(state.profiles)];`,
        [namespace([{ path: 'files.read', tool: 'read_file', doc: '', schema: {}, output: {} }]).commands().find(node => node.path === 'files.read')!.binding()],
        async () => true, new AbortController().signal,
        { 'tools.profile.profiles': { profiles: ['Default'], selected: 'Default' } },
        async () => ({ 'tools.profile.profiles': { profiles: ['Copy', 'Default'], selected: 'Copy' } }));
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, ['{"profiles":["Default"],"selected":"Default"}', 'Copy', ['Copy', 'Default'], true, true, true]);
    } finally { await host.dispose(); }
});


test('Profile save validates input and undefined name overwrites the current selection, ignoring profile.name', async () => {
    const { call, load, catalog, registry } = await fixture();
    const profile = await load();
    for (const args of [{}, { profile: undefined }, { profile: {} }, { name: null, profile }, { name: 42, profile }]) {
        await assert.rejects(call('tools_profile_save', args));
    }
    assert.deepEqual(catalog.snapshot().profiles, ['Default']);
    await call('tools_profile_save', { name: 'Copy', profile });
    const updated = { ...profile, name: 'Ignored', root: { ...profile.root, children: { ...profile.root.children, business: {
        type: 'namespace', permissions: profile.root.permissions, children: {},
    } } } };
    const before = registry.snapshot();
    await call('tools_profile_save', { profile: updated });
    assert.deepEqual(registry.snapshot(), before);
    assert.equal(registry.snapshot().profile, 'Default');
    assert(!catalog.configuration('Copy').namespaces.some(node => node.path === 'business'));
    assert(catalog.configuration('Default').namespaces.some(node => node.path === 'business'));
    assert(!registry.configuration().namespaces.some(node => node.path === 'business'));
    await call('tools_profile_switch', { name: 'Default' });
    assert(registry.configuration().namespaces.some(node => node.path === 'business'));
    assert.deepEqual(catalog.snapshot().profiles, ['Copy', 'Default']);
});


test('Profile deletion rejects the current selection and missing entries, and can remove the catalog default', async () => {
    const { call, load, catalog, registry } = await fixture();
    await assert.rejects(call('tools_profile_delete'), /name/);
    await assert.rejects(call('tools_profile_delete', { name: 'Default' }), /Current Profile cannot be deleted: Default/);
    await assert.rejects(call('tools_profile_delete', { name: 'Missing' }), /Profile does not exist/);
    const profile = await load();
    await call('tools_profile_save', { name: 'Copy', profile });
    await call('tools_profile_switch', { name: 'Copy' });
    await assert.rejects(call('tools_profile_delete', { name: 'Copy' }), /Current Profile cannot be deleted: Copy/);
    await call('tools_profile_delete', { name: 'Default' });
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Copy'], selected: 'Copy' });
    assert.equal(registry.snapshot().profile, 'Copy');
    assert.equal(catalog.snapshot().profile, 'Copy');
    await assert.rejects(call('tools_profile_delete', { name: 'Default' }), /Profile does not exist/);
});


test('Profile switch requires a name and supports disabling through server permissions', async () => {
    const { call, load, catalog, registry, definitions } = await fixture();
    const profile = await load();
    await call('tools_profile_save', { name: 'Copy', profile });
    await call('tools_profile_switch', { name: 'Copy' });
    assert.equal(registry.snapshot().profile, 'Copy');
    assert.equal(catalog.snapshot().profile, 'Default');
    for (const args of [{}, { name: null }, { name: '' }, { name: 42 }, { name: 'Missing' }]) {
        await assert.rejects(call('tools_profile_switch', args));
    }
    const edited = await load();
    const command = edited.root.children!['tools'].children!['profile'].children!['switch'];
    assert.equal(command.permissions?.disableable, undefined);
    assert.equal(nodePermissions('leaf', command.permissions).disableable, true);
    command.disabled = true;
    await call('tools_profile_save', { profile: edited });
    assert(!registry.configuration().builtinDisabled?.includes('tools.profile.switch'));
    await call('tools_profile_switch', { name: 'Copy' });
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema })));
    assert(!manifest(registry, []).commands().some(node => node.path === 'tools.profile.switch'));
    assert((await load()).root.children!['tools'].children!['profile'].children!['switch'].disabled);
});


test('Profile load reads catalog data without replacing the working draft or refreshing tools', async () => {
    const { call, load, catalog, registry, changed } = await fixture();
    const draft = await load();
    const copy = { ...draft, name: 'Copy', root: { ...draft.root, children: { ...draft.root.children, catalog_only: {
        type: 'namespace', permissions: draft.root.permissions, children: {},
    } } } };
    await call('tools_profile_save', { name: 'Copy', profile: copy });
    const before = registry.snapshot();
    const catalogBefore = catalog.snapshot();
    const loaded = await load({ name: 'Copy' });
    assert.equal(loaded.name, 'Copy');
    assert(Object.hasOwn(loaded.root.children!, 'catalog_only'));
    assert(!Object.hasOwn(draft.root.children!, 'catalog_only'));
    assert.deepEqual(await call('tools_profile_load'), draft);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(catalog.snapshot(), catalogBefore);
    await assert.rejects(call('tools_profile_load', { name: 'Missing' }), /Profile does not exist/);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(changed, []);
});


test('Profile setdefault persists the default for new sessions and preserves existing drafts', async () => {
    const { call, load, catalog, registry, changed, definitions } = await fixture();
    const profile = await load();
    await call('tools_profile_save', { name: 'Copy', profile });
    const before = registry.snapshot();
    assert.equal(await call('tools_profile_setdefault', { name: 'Copy' }), null);
    assert.equal(catalog.snapshot().profile, 'Copy');
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(changed, []);
    assert.equal((await new ProfileSessions(catalog, new MemoryStore()).forSession('new')).snapshot().profile, 'Copy');
    const revision = catalog.snapshot().revision;
    await call('tools_profile_setdefault', { name: 'Copy' });
    assert.equal(catalog.snapshot().revision, revision);
    for (const args of [{}, { name: undefined }, { name: null }, { name: '' }, { name: 42 }, { name: 'Missing' }]) {
        await assert.rejects(call('tools_profile_setdefault', args));
    }
    assert.equal(catalog.snapshot().profile, 'Copy');
    await call('tools_profile_setdefault', { name: 'Default' });
    assert.equal(catalog.snapshot().profile, 'Default');
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema })));
    const entry = manifest(registry, []).commands().find(node => node.path === 'tools.profile.setdefault')!;
    assert.deepEqual(await positionalArguments(entry, ['Copy']), { name: 'Copy' });
    assert(inspect(['tools.profile.setdefault'], manifest(registry, []), true).includes('setdefault(name: string)'));
    const edited = await load();
    const command = edited.root.children!['tools'].children!['profile'].children!['setdefault'];
    assert.equal(command.permissions?.disableable, undefined);
    assert.equal(nodePermissions('leaf', command.permissions).disableable, true);
    command.disabled = true;
    await call('tools_profile_save', { profile: edited });
    await call('tools_profile_switch', { name: 'Default' });
    assert(!manifest(registry, []).commands().some(node => node.path === 'tools.profile.setdefault'));
});

test('agent Profile load keeps plain JSON data while host profiles are classes', async () => {
    const { registry, call } = await fixture();
    const hostProfile = profileTree('Default', registry.configuration());
    assert(hostProfile instanceof Profile);
    const profile = await call('tools_profile_load');
    assert.equal(Object.getPrototypeOf(profile), Object.prototype);
    assert.deepEqual(Object.keys(profile as object).sort(), ['name', 'root']);
    assert.equal('save' in (profile as object), false);
    assert.deepEqual(profile, JSON.parse(JSON.stringify(hostProfile.save())));
    assert.equal(profileAnnotation.includes('save():'), false);
    assert.equal(profileAnnotation.includes('constructor('), false);
});

test('PTC agents can load, edit, save and switch plain Profile trees across host class boundaries', async () => {
    const { registry, catalog, definitions, call } = await fixture();
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema })));
    const host = new RuntimeHost({ timeoutMs: 3000 });
    const before = registry.configuration();
    const commands = manifest(registry, []).commands().filter(node => !node.preload).map(node => node.binding());
    try {
        const result = await host.execute('profile_classes', 'roundtrip', `
            const profile = await tools.profile.load();
            const plain = Object.getPrototypeOf(profile) === Object.prototype && !('save' in profile);
            profile.root.children['agent_draft'] = { type: 'namespace',
                permissions: profile.root.permissions, children: {}, description: 'Agent draft' };
            await tools.profile.save('AgentCopy', profile);
            const catalog = await tools.profile.load('AgentCopy');
            const current = await tools.profile.load();
            await tools.profile.switch('AgentCopy');
            const selected = await tools.profile.load();
            return [plain, catalog.name, current.name, selected.name,
                Object.hasOwn(selected.root.children, 'agent_draft'),
                Object.hasOwn(current.root.children, 'agent_draft')];
        `, commands, async (tool, args) => call(tool, args), new AbortController().signal);
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, [true, 'AgentCopy', 'Default', 'AgentCopy', true, false]);
        assert(registry.configuration().namespaces.some(node => node.path === 'agent_draft'));
        assert.deepEqual(catalog.configuration('Default'), before);
    } finally { await host.dispose(); }
});

test('Profile save defaults protected tools to disabled and honors explicit enablement', async () => {
    const { call, load, catalog, registry, definitions, changed } = await fixture();
    const before = registry.snapshot();
    for (const state of ['missing', 'omitted', true, false] as const) {
        const profile = await load();
        const tools = profile.root.children!['tools'];
        if (state === 'missing') delete profile.root.children!['tools'];
        else if (state === 'omitted') delete tools.disabled;
        else tools.disabled = state;
        const input = structuredClone(profile);
        await call('tools_profile_save', { name: 'Copy', profile });
        const saved = await load({ name: 'Copy' });
        assert.equal(saved.root.children!['tools'].disabled ?? false, state !== false);
        assert.equal(catalog.configuration('Copy').builtinDisabled.includes('tools'), state !== false);
        assert.deepEqual(profile, input);
        assert.deepEqual(registry.snapshot(), before);
    }
    assert.deepEqual(changed, []);
    assert(definitions.get('tools_profile_save')!.description.includes('`tools` namespace is protected and defaults to disabled'));
    assert(profileAnnotation.includes('excluded from') || profileAnnotation.includes('disappear from discovery'));
    assert(profileAnnotation.includes('preloaded values and pinned prompts'));
});

test('Profile save reports completion and advisory discovery issues without changing pins or blocking persistence', async () => {
    const { call, load, catalog, registry, definitions } = await fixture();
    const completed = 'info: `tools` namespace is completed.';
    const advisory = 'warning: `inspect` is disabled when there are some commands not fixed with level 2.';
    const profile = await load();
    profile.root.children!['files'] = { type: 'namespace', children: {
        read: { type: 'command', fixedLevel: 1, command: { tool: 'read_file' } },
    } };
    const before = registry.snapshot();
    assert.equal(await call('tools_profile_save', { name: 'Info', profile }), advisory);
    assert.equal(catalog.configuration('Info').mappings[0]!.alwaysVisible, 1);
    assert.deepEqual(registry.snapshot(), before);
    delete profile.root.children!['tools'];
    assert.equal(await call('tools_profile_save', { name: 'Info', profile }), `${completed}\n${advisory}`);
    profile.root.children!['files']!.children!['read']!.fixedLevel = 2;
    assert.equal(await call('tools_profile_save', { name: 'Info', profile }), completed);
    const complete = await load({ name: 'Info' });
    assert.equal(await call('tools_profile_save', { name: 'Info', profile: complete }), null);
    const partial = await load({ name: 'Info' });
    partial.root.children!['tools'].children!['profile'].children = {};
    assert.equal(await call('tools_profile_save', { name: 'Info', profile: partial }), completed);
    const schema = definitions.get('tools_profile_save')!.output.schema;
    assert.deepEqual(schema, { oneOf: [{ type: 'string' }, { type: 'null' }] });
});

test('Profile save checks enabled descendants and requires callable inspect regardless of search availability', async () => {
    const { call, load, registry } = await fixture();
    registry.refresh([...registry.tools(), ...['tools_inspect', 'tools_search'].map(id => ({ id, description: '', parameters: {}, output: {} }))]);
    const profile = await load();
    const tools = profile.root.children!['tools'];
    tools.disabled = false;
    const inspect = tools.children!['inspect'];
    const search = tools.children!['search'];
    for (const [inspectDisabled, searchDisabled] of [[true, false], [false, true], [true, true]]) {
        inspect.disabled = inspectDisabled;
        search.disabled = searchDisabled;
        const information = await call('tools_profile_save', { name: 'Discovery', profile });
        assert.equal(typeof information === 'string', inspectDisabled);
    }
    tools.children!['profile'].disabled = true;
    assert.equal(await call('tools_profile_save', { name: 'Discovery', profile }), null);
    profile.root.children!['files'] = { type: 'namespace', disabled: true, children: {
        read: { type: 'command', command: { tool: 'read_file' } },
    } };
    assert.equal(await call('tools_profile_save', { name: 'Discovery', profile }), null);
});


test('Profile apply recursively patches a named catalog tree and deletes null fields', async () => {
    const { call, load, registry, changed } = await fixture();
    const profile = await load();
    profile.brief = 'Original';
    profile.root.fixedLevel = 1;
    profile.root.children!['files'] = { type: 'namespace', description: 'Files', children: {
        read: { type: 'command', command: { tool: 'read_file' }, fixedLevel: 2 },
    } };
    await call('tools_profile_save', { name: 'Copy', profile });
    const before = registry.snapshot();
    const original = await load({ name: 'Copy' });
    await call('tools_profile_apply', { name: 'Copy', value: { brief: null, root: { fixedLevel: null } } });
    const patched = await load({ name: 'Copy' });
    assert.equal(patched.brief, undefined);
    assert.equal(patched.root.fixedLevel, undefined);
    assert.deepEqual(patched.root.children, original.root.children);
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(changed, []);
    await call('tools_profile_apply', { name: 'Copy', value: { root: { children: { files: { children: { read: { command: { doc: 'Patched read' } } } } } } } });
    const merged = await load({ name: 'Copy' });
    assert.equal(merged.root.children!['files']!.children!['read']!.command!.doc, 'Patched read');
    assert.equal(merged.root.children!['files']!.children!['read']!.command!.tool, 'read_file');
    assert(Object.hasOwn(merged.root.children!, 'tools'));
    await call('tools_profile_apply', { name: 'Copy', value: { root: { children: { files: null } } } });
    assert(!Object.hasOwn((await load({ name: 'Copy' })).root.children!, 'files'));
    assert(Object.hasOwn((await load({ name: 'Copy' })).root.children!, 'tools'));
});

test('Profile apply without a name reads the conversation draft before saving', async () => {
    const { call, load, registry, changed } = await fixture();
    await call('tools_profile_apply', { value: { brief: 'Catalog edit', root: { fixedLevel: 1 } } });
    assert.equal((await load({ name: 'Default' })).brief, 'Catalog edit');
    assert.equal((await load()).brief, undefined);
    await call('tools_profile_apply', { value: { brief: 'Draft edit' } });
    const saved = await load({ name: 'Default' });
    assert.equal(saved.brief, 'Draft edit');
    assert.equal(saved.root.fixedLevel, undefined);
    assert.equal(registry.snapshot().profile, 'Default');
    assert.deepEqual(changed, []);
});

test('Profile apply rejects invalid patches and unknown targets without saving', async () => {
    const { call, load } = await fixture();
    const before = await load({ name: 'Default' });
    for (const args of [{}, { value: null }, { value: [] }, { name: 1, value: {} }, { name: 'Missing', value: {} },
        { value: { root: null } }, { value: { root: { fixedLevel: 2 } } }, { value: { unknown: true } }]) {
        await assert.rejects(call('tools_profile_apply', args));
    }
    assert.deepEqual(await load({ name: 'Default' }), before);
});
