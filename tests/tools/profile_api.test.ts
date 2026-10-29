import { NamespaceComponent } from '../../src/namespace/component.js';
import { EditableCommand } from '../../src/registry/profile/command.js';
import { EditableNamespace } from '../../src/registry/profile/namespace.js';
import { ValidationError, CurrentProfileDeletionError, UnknownCommandError, ProfileNotFoundError, ConversationRequiredError } from '../../src/error.js';
import { profileWrite } from '../../src/registry/profile_write.js';
import { namespace, positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { ProfileDocument, ProfileSchema, profileAnnotation, profileTree } from '../../src/registry/profile_tree.js';
import { MemoryStore } from '../../src/storage/store.js';
import { registerToolCommands } from '../../src/tools/tool_commands.js';
import { manifest } from '../../src/namespace/namespace.js';
import { nodePermissions } from '../../src/namespace/node.js';
import { inspect } from '../../src/tools/inspect.js';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { RuntimeHost } from '../../src/runtime/host.js';

/** @brief Exercise native command handlers using a real catalog and session references. */
async function fixture() {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: (work: () => unknown) => work(), tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => {}; } } } as unknown as Context;
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const physical = { id: 'read_file', description: 'Read a file.', parameters: { type: 'object' }, output: { type: 'string' } };
    catalog.refresh([physical]);
    const profiles = new ProfileSessions(catalog, new MemoryStore());
    const registry = await profiles.forSession('session');
    registry.refresh([physical]);
    const changed: string[] = [];
    const serviceContext = new Context();
    const namespaces = new NamespaceIntegration(serviceContext, new NamespaceComponent(serviceContext, catalog), profiles);
    namespaces.registryFor = async () => registry;
    namespaces.commandBriefs = async () => [{ name: physical.id, brief: physical.description, paths: ['files.read', 'files.cat'], totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', paths: [], totalCalls: 0 }];
    registerToolCommands(ctx, catalog, profiles, async () => registry, async agent => { changed.push(agent.id); }, agent => namespaces.commandBriefs(agent), namespaces);
    const agentContext = new Context();
    agentContext.provide('namespaceIntegration', { isPtc: () => true } as unknown as Context['namespaceIntegration']);
    const execution = { agent: { id: 'session', inject: () => {}, ctx: agentContext, session: Session.create(SessionId('session')) }, signal: new AbortController().signal } as unknown as ToolRunContext;
    const call = (name: string, args: unknown = {}) => definitions.get(name)!.execute(args, execution);
    const load = async (args: unknown = {}) => ProfileSchema.parse(await call('tools_profile_load', args));
    return { definitions, registry, catalog, call, load, changed, execution, store, namespaces };
}

test('native Profile data tools and optional-name save/load use session defaults', async () => {
    const { definitions, call, registry, catalog } = await fixture();
    assert.deepEqual([...definitions.keys()].sort(), ['tools_profile_annotation', 'tools_profile_apply', 'tools_profile_commands', 'tools_profile_delete', 'tools_profile_load', 'tools_profile_profiles', 'tools_profile_save', 'tools_profile_setdefault', 'tools_profile_switch']);
    assert.equal(await call('tools_profile_annotation'), profileAnnotation);
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Default'], selected: 'Default' });
    assert.deepEqual(await call('tools_profile_commands'), [{ name: 'read_file', brief: 'Read a file.', paths: ['files.read', 'files.cat'], totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', paths: [], totalCalls: 0 }]);
    const profile = JSON.parse(JSON.stringify(profileTree('Ignored', { ...registry.configuration(), namespaces: [{ path: 'files', description: '', alwaysVisible: true }], mappings: [{ id: 'read_file', path: 'files.read', pinned: false, alwaysVisible: 2 }], toolComments: { read_file: 'Read text' } }))); 
    const before = registry.snapshot();
    await call('tools_profile_save', { profile: profileWrite(profile) });
    assert.deepEqual(registry.snapshot(), before);
    const savedProfile = structuredClone(profile);
    savedProfile.root.children['tools'].disabled = true;
    assert.deepEqual(JSON.parse(JSON.stringify(profileTree('Default', catalog.configuration('Default')))), { ...savedProfile, name: 'Default' });
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
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
    assert(vm.includes('save(profile: ProfileWrite)'));
    assert(vm.includes('apply(value: ProfilePatch)'));
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
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
    const updated = { ...profile, name: 'Ignored', root: { ...profile.root, children: { ...profile.root.children, business: {
        type: 'namespace', permissions: profile.root.permissions, children: {},
    } } } };
    const before = registry.snapshot();
    await call('tools_profile_save', { profile: profileWrite(updated) });
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
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
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
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
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
    await call('tools_profile_save', { profile: profileWrite(edited) });
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
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(copy) });
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
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
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
    await call('tools_profile_save', { profile: profileWrite(edited) });
    await call('tools_profile_switch', { name: 'Default' });
    assert(!manifest(registry, []).commands().some(node => node.path === 'tools.profile.setdefault'));
});

test('agent Profile load keeps plain JSON data while host profiles are classes', async () => {
    const { registry, call } = await fixture();
    const hostProfile = profileTree('Default', registry.configuration());
    assert(hostProfile instanceof ProfileDocument);
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
    const before = profileTree('Default', registry.configuration(), catalog.definitions).root;
    const commands = manifest(registry, []).commands().filter(node => !node.preload).map(node => node.binding());
    try {
        const result = await host.execute('profile_classes', 'roundtrip', `
            const profile = await tools.profile.load();
            const plain = Object.getPrototypeOf(profile) === Object.prototype && !('save' in profile);
            profile.root.children['agent_draft'] = { type: 'namespace',
                permissions: profile.root.permissions, children: {}, description: 'Agent draft' };
            const write = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'permissions' && key !== 'name').map(([key, child]) => [key, child && typeof child === 'object' ? write(child) : child]));
            await tools.profile.save('AgentCopy', write({ brief: profile.brief, root: { type: profile.root.type, children: profile.root.children } }));
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
        assert.deepEqual(profileTree('Default', catalog.configuration('Default'), catalog.definitions).root, before);
    } finally { await host.dispose(); }
});

test('Profile save defaults protected tools to disabled and honors explicit enablement', async () => {
    const { call, load, catalog, registry, definitions, changed } = await fixture();
    const before = registry.snapshot();
    for (const state of ['missing', 'omitted', true, false] as const) {
        const profile = await load();
        const tools = profile.root.children!['tools'];
        if (state === 'missing') {
            delete profile.root.children!['tools'];
            await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
            assert.equal((await load({ name: 'Copy' })).root.children!.tools.disabled, true);
            continue;
        }
        else if (state === 'omitted') delete tools.disabled;
        else tools.disabled = state;
        const input = structuredClone(profile);
        await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
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

test('Profile annotation keeps field semantics without repeating Profile command guidance', () => {
    const schema = JSON.stringify(ProfileSchema.toJSONSchema());
    for (const text of [profileAnnotation, schema]) {
        assert(!text.includes('defaults to disabled'));
        assert(!text.includes('tools.profile.save'));
        assert(!text.includes('tools.profile.switch'));
        assert(!text.includes('fix all other commands'));
        assert(text.includes('disabled'));
        assert(text.includes('permissions'));
    }
    assert(profileAnnotation.includes('The live runtime namespace tree must not be mutated'));
    assert(profileAnnotation.includes('children.cwd'));
});

test('Profile save repairs protected omissions and reports advisory discovery issues without changing pins or blocking persistence', async () => {
    const { call, load, catalog, registry, definitions } = await fixture();
    const advisory = 'warning: `tools.inspect` is disabled when there are some enabled commands not fixed with level 2.';
    const profile = await load();
    profile.root.children!['files'] = { type: 'namespace', children: {
        read: { type: 'command', fixedLevel: 1, command: { tool: 'read_file' } },
    } };
    const before = registry.snapshot();
    assert.equal(await call('tools_profile_save', { name: 'Info', profile: profileWrite(profile) }), advisory);
    assert.equal(catalog.configuration('Info').mappings[0]!.alwaysVisible, 1);
    assert.deepEqual(registry.snapshot(), before);
    delete profile.root.children!['tools'];
    assert.equal(await call('tools_profile_save', { name: 'Info', profile: profileWrite(profile) }), advisory);
    assert((await load({ name: 'Info' })).root.children!.tools);
    profile.root.children!['tools'] = (await load()).root.children!['tools'];
    profile.root.children!['files']!.children!['read']!.fixedLevel = 2;
    await call('tools_profile_save', { name: 'Info', profile: profileWrite(profile) });
    const complete = await load({ name: 'Info' });
    assert.equal(await call('tools_profile_save', { name: 'Info', profile: profileWrite(complete) }), null);
    const partial = await load({ name: 'Info' });
    partial.root.children!['tools'].children!['profile'].children = {};
    await call('tools_profile_save', { name: 'Info', profile: profileWrite(partial) });
    assert((await load({ name: 'Info' })).root.children!.tools.children!.profile.children!.save);
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
        const information = await call('tools_profile_save', { name: 'Discovery', profile: profileWrite(profile) });
        assert.equal(typeof information === 'string', inspectDisabled);
    }
    tools.children!['profile'].disabled = true;
    assert.equal(await call('tools_profile_save', { name: 'Discovery', profile: profileWrite(profile) }), null);
    profile.root.children!['files'] = { type: 'namespace', disabled: true, children: {
        read: { type: 'command', command: { tool: 'read_file' } },
    } };
    assert.equal(await call('tools_profile_save', { name: 'Discovery', profile: profileWrite(profile) }), null);
});


test('Profile apply recursively patches a named catalog tree and deletes null fields', async () => {
    const { call, load, registry, changed } = await fixture();
    const profile = await load();
    profile.brief = 'Original';

    profile.root.children!['files'] = { type: 'namespace', description: 'Files', children: {
        read: { type: 'command', command: { tool: 'read_file' }, fixedLevel: 2 },
    } };
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
    const before = registry.snapshot();
    const original = await load({ name: 'Copy' });
    await call('tools_profile_apply', { name: 'Copy', value: { brief: null } });
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

test('Profile apply preserves tools subtree states for catalog and draft patches', async () => {
    for (const name of [undefined, 'Default']) {
        for (const disabled of [false, true]) {
            const { call, load, registry, changed } = await fixture();
            const profile = await load();
            const tools = profile.root.children!['tools']!;
            tools.disabled = disabled;
            tools.children!['profile']!.disabled = disabled;
            tools.children!['profile']!.fixedLevel = 1;
            tools.children!['profile']!.children!['load']!.disabled = disabled;
            tools.children!['search']!.disabled = !disabled;
            await call('tools_profile_save', { profile: profileWrite(profile) });
            await call('tools_profile_switch', { name: 'Default' });
            const before = await load();
            const snapshot = registry.snapshot();
            changed.length = 0;
            await call('tools_profile_apply', { ...(name === undefined ? {} : { name }), value: { brief: 'Only change brief' } });
            assert.deepEqual((await load({ name: 'Default' })).root, before.root);
            assert.deepEqual(registry.snapshot(), snapshot);
            assert.deepEqual(changed, []);
            await call('tools_profile_apply', { ...(name === undefined ? {} : { name }), value: { root: { children: { tools: {
                disabled: !disabled, children: { profile: { disabled: !disabled, children: { load: { disabled: !disabled } } } },
            } } } } });
            const patched = (await load({ name: 'Default' })).root.children!['tools']!;
            assert.equal(patched.disabled ?? false, !disabled);
            assert.equal(patched.children!['profile']!.disabled ?? false, !disabled);
            assert.equal(patched.children!['profile']!.children!['load']!.disabled ?? false, !disabled);
            assert.equal(patched.children!['profile']!.fixedLevel, 1);
            assert.deepEqual(patched.children!['search'], before.root.children!['tools']!.children!['search']);
        }
    }
});

test('Profile apply without a name reads the conversation draft before saving', async () => {
    const { call, load, registry, changed } = await fixture();
    await call('tools_profile_apply', { value: { brief: 'Catalog edit' } });
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


test('Profile save and apply reject forbidden writes atomically, including raw JSON prototype keys', async () => {
    const { call, load, registry, catalog } = await fixture();
    const original = await load();
    const before = catalog.snapshot();
    const draft = registry.snapshot();
    const patches = [
        ...['', '$evil', '__proto__', 'constructor', 'prototype', 'then', 'toString'].map(name =>
            JSON.parse(JSON.stringify({ root: { children: { [name]: { type: 'namespace' } } } }))),
    ];
    for (const value of patches) {
        await assert.rejects(call('tools_profile_apply', { value }));
        assert.deepEqual(catalog.snapshot(), before);
        assert.deepEqual(registry.snapshot(), draft);
    }
    for (const name of ['', '$evil', '__proto__', 'constructor', 'prototype', 'then', 'toString']) {
        const profile = structuredClone(original);
        Object.defineProperty(profile.root.children!, name, { value: { type: 'namespace' }, enumerable: true, configurable: true });
        await assert.rejects(call('tools_profile_save', { profile: JSON.parse(JSON.stringify(profile)) }));
        assert.deepEqual(catalog.snapshot(), before);
    }
});


test('Profile apply renames ordinary mounts only when the original key is explicitly deleted', async () => {
    const { call, load } = await fixture();
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: {
        bash: { type: 'command', command: { tool: 'read_file' } },
    } } } });
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: {
        bash2: { type: 'command', command: { tool: 'read_file' } },
    } } } });
    let profile = await load({ name: 'Default' });
    assert(profile.root.children!['bash']);
    assert(profile.root.children!['bash2']);
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: { bash: null } } } });
    profile = await load({ name: 'Default' });
    assert(!Object.hasOwn(profile.root.children!, 'bash'));
    assert(profile.root.children!['bash2']);
});


test('Profile save and apply allow namespaces sharing protected names at different paths', async () => {
    const { call, load } = await fixture();
    const profile = await load();
    const names = ['inspect', 'save', 'load', 'profile'];
    for (const name of names) profile.root.children![name] = { type: 'namespace' };
    profile.root.children!['custom'] = { type: 'namespace', children: { tools: { type: 'namespace' } } };
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(profile) });
    const saved = await load({ name: 'Copy' });
    for (const name of names) assert.equal(saved.root.children![name].type, 'namespace');
    assert.equal(saved.root.children!['tools'].children!['inspect'].type, 'command');
    await call('tools_profile_apply', { name: 'Copy', value: { root: { children: {
        custom: { children: { inspect: { type: 'namespace' } } },
    } } } });
    const applied = await load({ name: 'Copy' });
    assert.equal(applied.root.children!['custom'].children!['inspect'].type, 'namespace');
    assert.deepEqual(applied.root.children!['tools'], saved.root.children!['tools']);
    await assert.rejects(call('tools_profile_apply', { name: 'Copy', value: { root: { children: {
        tools: { children: { inspect: { type: 'namespace', command: null, fixedLevel: null } } },
    } } } }), /Required field cannot be deleted/);
    saved.root.children!['tools'].children!['inspect'] = { type: 'namespace' };
    await call('tools_profile_save', { name: 'Copy', profile: profileWrite(saved) });
    assert.equal((await load({ name: 'Copy' })).root.children!.tools.children!.inspect.type, 'command');
});


test('save and apply reject readonly name and permissions without changing catalog or draft', async () => {
    const { call, load, catalog, registry } = await fixture();
    const original = await load();
    const before = catalog.snapshot();
    const draft = registry.snapshot();
    const values = [
        { name: 'Hacked' }, { name: null },
        { root: { permissions: null } },
        { root: { children: { tools: { permissions: { acceptsChildren: true } } } } },
        { root: { children: { tools: { children: { search: { permissions: { acceptsChildren: true } } } } } } },
        { root: { children: { file: { type: 'command', command: { tool: 'read_file' }, permissions: { availableFixLevels: [] } } } } },
    ];
    for (const value of values) {
        await assert.rejects(call('tools_profile_apply', { value }), /Unknown or read-only field|Unrecognized key/);
        assert.deepEqual(catalog.snapshot(), before);
        assert.deepEqual(registry.snapshot(), draft);
    }
    for (const profile of [original, { ...profileWrite(original), name: original.name },
        { ...profileWrite(original), root: { ...original.root, permissions: null } }]) {
        await assert.rejects(call('tools_profile_save', { profile }), /Unknown or read-only field|Unrecognized key/);
        assert.deepEqual(catalog.snapshot(), before);
    }
});

test('apply reports null required fields explicitly and compact validation identifies exact node fields', async () => {
    const { call } = await fixture();
    await assert.rejects(call('tools_profile_apply', { value: { root: null } }), /root.*received null/);
    await assert.rejects(call('tools_profile_apply', { value: { root: { children: { files: { type: 'command', command: { tool: 'read_file' }, fixedLevel: 9 }, files2: { type: 'command', command: { tool: 'read_file' }, fixedLevel: 9 } } } } }), error => {
        const text = (error as Error).message;
        const data = JSON.parse(text);
        assert.equal((error as Error).name, 'ZodError');
        assert.equal(data.type, 'ZodError');
        assert(data.issues.some((issue: { path: string }) => issue.path === 'root.children.files.fixedLevel'));
        assert(text.length < 700, text);
        return true;
    });
});

test('apply rejects additions to protected namespaces and command children', async () => {
    const { call } = await fixture();
    for (const parent of ['tools', 'profile']) {
        const addition = { children: { added: { type: 'command', command: { tool: 'read_file' } } } };
        const tools = parent === 'tools' ? addition : { children: { profile: addition } };
        await assert.rejects(call('tools_profile_apply', { value: { root: { children: { tools } } } }), /Namespace does not accept children: tools/);
    }
    await assert.rejects(call('tools_profile_apply', { value: { root: { children: { tools: { children: { search: { children: { child: { type: 'namespace' } } } } } } } } }), /children.*Unknown or read-only field|Unrecognized key/);
});

test('nested rename and move persist in the catalog while session paths change only on switch', async () => {
    const { call, load, catalog, registry } = await fixture();
    const mount = { type: 'command', command: { tool: 'read_file', doc: 'Read text' }, fixedLevel: 1 };
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: { file: { type: 'namespace', children: { read: mount } } } } } });
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: { file: { children: { read: null, read2: mount } } } } } });
    assert.deepEqual(catalog.configuration('Default').mappings.map(item => item.path), ['file.read2']);
    assert.deepEqual(registry.configuration().mappings, []);
    assert(!(await load()).root.children!['file']);
    const saved = await load({ name: 'Default' });
    assert(!saved.root.children!['file'].children!['read']);
    await call('tools_profile_switch', { name: 'Default' });
    assert.deepEqual(registry.configuration().mappings.map(item => item.path), ['file.read2']);
    await call('tools_profile_apply', { name: 'Default', value: { root: { children: { file: { children: { read2: null } }, moved: mount } } } });
    assert.deepEqual(catalog.configuration('Default').mappings.map(item => item.path), ['moved']);
    assert.deepEqual(registry.configuration().mappings.map(item => item.path), ['file.read2']);
});

test('guest positional failures are typed ToolCallError subclasses with namespace paths', async () => {
    const { registry, definitions, call } = await fixture();
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema })));
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const result = await host.execute('argument_errors', 'one', `
            const results = [];
            for (const args of [[], [undefined, {}, {}]]) {
                try { await tools.profile.apply(...args); }
                catch (error) { results.push([error instanceof ToolCallError, error instanceof PositionalArgumentError, error.toolName, error.code]); }
            }
            return results;`, manifest(registry, []).commands().filter(node => !node.preload).map(node => node.binding()),
        async (tool, args) => call(tool, args), new AbortController().signal);
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, Array.from({ length: 2 }, () => [true, true, 'tools.profile.apply', 'invalid_argument_count']));
    } finally { await host.dispose(); }
});


test('save and apply reject anonymous root settings that have no persistent representation', async () => {
    const { call, load, catalog, registry } = await fixture();
    const write = profileWrite(await load());
    const saved = catalog.snapshot();
    const draft = registry.snapshot();
    for (const [field, value] of [['disabled', true], ['disabled', false], ['fixedLevel', 1], ['fixedLevel', 0], ['description', 'Ignored']]) {
        await assert.rejects(call('tools_profile_save', { profile: { ...write, root: { ...write.root, [field as string]: value } } }), /Unknown or read-only field/);
        for (const patch of [value, null]) {
            await assert.rejects(call('tools_profile_apply', { value: { root: { [field as string]: patch } } }), ValidationError);
        }
        assert.deepEqual(catalog.snapshot(), saved);
        assert.deepEqual(registry.snapshot(), draft);
    }
});

test('Profile failures use explicit domain error classes and save shares patch protection', async () => {
    const { call, load, definitions, catalog } = await fixture();
    await assert.rejects(call('tools_profile_delete', { name: 'Default' }), CurrentProfileDeletionError);
    await assert.rejects(call('tools_profile_load', { name: 'Missing' }), ProfileNotFoundError);
    await assert.rejects(call('tools_profile_apply', { value: { root: { children: { unknown: { type: 'command', command: { tool: 'missing_tool' } } } } } }), UnknownCommandError);
    await assert.rejects(definitions.get('tools_profile_load')!.execute({}, { signal: new AbortController().signal } as ToolRunContext), ConversationRequiredError);
    const write = profileWrite(await load());
    const before = catalog.snapshot();
    for (const permissions of [null, {}, { acceptsChildren: true }, { availableFixLevels: [9] }, { availableFixLevels: [] }]) {
        const profile = structuredClone(write);
        const tools = profile.root.children!['tools']!;
        Object.assign(tools, { permissions });
        await assert.rejects(call('tools_profile_save', { profile }), /Unknown or read-only field/);
        assert.deepEqual(catalog.snapshot(), before);
    }
});

test('concurrent conversations preserve independent patches to the same catalog Profile', async () => {
    const { definitions, execution, load, registry } = await fixture();
    const apply = definitions.get('tools_profile_apply')!;
    const before = registry.snapshot();
    const executions = Array.from({ length: 8 }, (_, index) => ({ ...execution,
        agent: { ...execution.agent!, id: `session_${index}` },
    } as ToolRunContext));
    await Promise.all(executions.map((context, index) => apply.execute({ name: 'Default', value: { root: { children: {
        [`mount_${index}`]: { type: 'command', command: { tool: 'read_file' } },
    } } } }, context)));
    const saved = await load({ name: 'Default' });
    for (let index = 0; index < executions.length; index++) assert.equal(saved.root.children![`mount_${index}`].command!.tool, 'read_file');
    assert.deepEqual(registry.snapshot(), before);
});

test('Profile lock releases after another conversation fails validation or cancellation', async () => {
    const { definitions, execution, load } = await fixture();
    const apply = definitions.get('tools_profile_apply')!;
    const aborted = new AbortController();
    aborted.abort();
    const other = { ...execution, agent: { ...execution.agent!, id: 'other' } } as ToolRunContext;
    const results = await Promise.allSettled([
        apply.execute({ name: 'Default', value: { root: { children: { tools: { children: { extra: { type: 'namespace' } } } } } } }, execution),
        apply.execute({ name: 'Default', value: { brief: 'Cancelled' } }, { ...other, signal: aborted.signal }),
        apply.execute({ name: 'Default', value: { brief: 'Saved after failures' } }, other),
    ]);
    assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected', 'fulfilled']);
    assert.equal((await load({ name: 'Default' })).brief, 'Saved after failures');
});

test('Profile lock blocks other conversations until persistence completes and checks waiting cancellation', async () => {
    const { definitions, execution, store, catalog } = await fixture();
    const apply = definitions.get('tools_profile_apply')!;
    const load = definitions.get('tools_profile_load')!;
    const other = { ...execution, agent: { ...execution.agent!, id: 'other' } } as ToolRunContext;
    const before = catalog.snapshot();
    let entered!: () => void;
    let release!: () => void;
    const persisting = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const save = store.save.bind(store);
    store.save = async (key, value) => { entered(); await blocked; await save(key, value); };
    const write = apply.execute({ name: 'Default', value: { brief: 'Committed' } }, execution);
    await persisting;
    const controller = new AbortController();
    const cancelled = apply.execute({ name: 'Default', value: { brief: 'Cancelled' } }, { ...other, signal: controller.signal });
    const rejected = assert.rejects(cancelled, error => error instanceof Error && error.name === 'AbortError');
    let readFinished = false;
    const read = load.execute({ name: 'Default' }, other).then(value => { readFinished = true; return value; });
    try {
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(readFinished, false);
        assert.deepEqual(catalog.snapshot(), before);
        controller.abort();
    } finally { release(); }
    await write;
    await rejected;
    assert.equal((await read as { brief?: string }).brief, 'Committed');
});


test('agent save effects restore builtin nodes in an explicitly empty plugin Profile', async () => {
    const { catalog, call, load } = await fixture();
    await catalog.saveProfile('Empty', { ...catalog.configuration(), providedRoot: { type: 'namespace', children: {} }, builtinVisible: {} }, { trusted: true });
    const initial = await load({ name: 'Empty' });
    assert.deepEqual(initial.root.children, {});
    await call('tools_profile_save', { name: 'Empty', profile: { root: { type: 'namespace', children: {
        files: { type: 'namespace', children: { read: { type: 'command', command: { tool: 'read_file' }, fixedLevel: 2 } } },
    } } } });
    const saved = await load({ name: 'Empty' });
    assert.equal(saved.root.children!.files.children!.read.command!.tool, 'read_file');
    assert.equal(saved.root.children!.tools.children!.inspect.fixedLevel, 2);
    assert.deepEqual(catalog.configuration('Empty').builtinDisabled, ['tools']);
});

test('save events expose only name, time and type after persistence and ignore observer results', async () => {
    const { namespaces, call, load, registry } = await fixture();
    const operations: string[] = [];
    const observed: string[] = [];
    const original = registry.snapshot();
    const first = namespaces.namespace.effect('save', async event => {
        assert.deepEqual(Object.keys(event).sort(), ['name', 'time', 'type']);
        assert.equal(Object.isFrozen(event), true);
        assert.equal(new Date(event.time).toISOString(), event.time);
        operations.push(`${event.type}:${event.name}`);
        const saved = await namespaces.namespace.get(event.name);
        assert(saved);
        observed.push(saved.brief ?? '');
        return 'Ignored observer feedback' as never;
    });
    const second = namespaces.namespace.effect('save', event => { operations.push(`observed:${event.type}`); });
    assert.equal(await call('tools_profile_save', { name: 'Effects', profile: profileWrite(await load()) }), null);
    assert.equal((await load({ name: 'Effects' })).brief, undefined);
    assert.equal(await call('tools_profile_apply', { name: 'Effects', value: { brief: 'Agent patch' } }), null);
    assert.deepEqual(operations, ['save:Effects', 'observed:save', 'apply:Effects', 'observed:apply']);
    assert.deepEqual(observed, ['', 'Agent patch']);
    assert.deepEqual(registry.snapshot(), original);
    first();
    second();
    await call('tools_profile_apply', { name: 'Effects', value: { brief: 'After disposal' } });
    assert.equal((await load({ name: 'Effects' })).brief, 'After disposal');
    assert.equal(operations.length, 4);
});

test('node validation failures never publish changes and event failures occur after commit', async () => {
    const { namespaces, call, load, catalog, registry } = await fixture();
    await namespaces.namespace.edit('Default', snapshot => {
        snapshot.create('external', () => new EditableNamespace('external')).create('read', () => new EditableCommand('read')).setTool('read_file').setPermissions({ removable: false, commentable: false });
        return snapshot;
    });
    const draft = registry.snapshot();
    const unregister = namespaces.namespace.effect('save', () => { throw new Error('Observer failed'); });
    await assert.rejects(call('tools_profile_apply', { name: 'Default', value: { brief: 'Committed' } }), /Observer failed/);
    assert.equal((await load({ name: 'Default' })).brief, 'Committed');
    const committed = catalog.snapshot();
    unregister();
    await assert.rejects(call('tools_profile_apply', { name: 'Default', value: { root: { children: { external: null } } } }), /cannot be removed: external.read/);
    assert.deepEqual(catalog.snapshot(), committed);
    assert.deepEqual(registry.snapshot(), draft);
});

test('save events are absent on failures and observer results preserve validation advisories', async () => {
    const { namespaces, call, load, catalog, store } = await fixture();
    let events = 0;
    const remove = namespaces.namespace.effect('save', () => { events++; return null as never; });
    const before = catalog.snapshot();
    await assert.rejects(call('tools_profile_apply', { value: { root: { children: { tools: null } } } }), /cannot be removed/);
    assert.equal(events, 0);
    const persist = store.save.bind(store);
    store.save = async () => { throw new Error('Persistence failed'); };
    await assert.rejects(call('tools_profile_save', { name: 'Failed', profile: profileWrite(await load()) }), /Persistence failed/);
    assert.equal(events, 0);
    assert.deepEqual(catalog.snapshot(), before);
    store.save = persist;
    const profile = profileWrite(await load());
    profile.root.children!.read = { type: 'command', command: { tool: 'read_file' } };
    assert.match(await call('tools_profile_save', { name: 'Saved', profile }) as string, /tools.inspect.*disabled/);
    assert.equal(events, 1);
    remove();
});

test('builtin nodes normalize differential saves and reject explicit deletion during apply', async () => {
    const { call, load } = await fixture();
    const profile = profileWrite(await load());
    const tools = profile.root.children!.tools!;
    tools.fixedLevel = 1;
    tools.description = 'Edited tool namespace';
    tools.children!.inspect = { type: 'command', fixedLevel: 0, command: { tool: 'read_file', doc: 'Edited discovery' } };
    delete tools.children!.profile;
    await call('tools_profile_save', { name: 'Repaired', profile });
    const saved = await load({ name: 'Repaired' });
    assert.equal(saved.root.children!.tools.fixedLevel ?? 0, 0);
    assert.equal(saved.root.children!.tools.children!.inspect.fixedLevel, 2);
    assert.equal(saved.root.children!.tools.children!.inspect.command!.tool, 'tools_inspect');
    assert.notEqual(saved.root.children!.tools.children!.inspect.command!.doc, 'Edited discovery');
    assert(saved.root.children!.tools.children!.profile.children!.save);
    await assert.rejects(call('tools_profile_apply', { name: 'Repaired', value: { root: { children: { tools: { disabled: false, children: { inspect: null } } } } } }), /cannot be removed: tools.inspect/);
    await call('tools_profile_apply', { name: 'Repaired', value: { root: { children: { tools: { disabled: false } } } } });
    const applied = await load({ name: 'Repaired' });
    assert.equal(applied.root.children!.tools.disabled ?? false, false);
    assert.equal(applied.root.children!.tools.children!.inspect.fixedLevel, 2);
});


test('post-save observers can use collection writes without holding the completed save transaction', { timeout: 2000 }, async () => {
    const { namespaces, call, load } = await fixture();
    const remove = namespaces.namespace.effect('save', async event => {
        await namespaces.namespace.edit(event.name, value => value.setBrief('Observed after commit'));
    });
    await call('tools_profile_save', { name: 'Observed', profile: profileWrite(await load()) });
    assert.equal((await load({ name: 'Observed' })).brief, 'Observed after commit');
    remove();
});
