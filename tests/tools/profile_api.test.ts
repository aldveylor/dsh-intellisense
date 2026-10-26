import { namespace, positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { profileAnnotation, profileTree } from '../../src/registry/profile_tree.js';
import { MemoryStore } from '../../src/storage/store.js';
import { registerToolCommands } from '../../src/tools/tool_commands.js';
import { manifest } from '../../src/namespace/namespace.js';
import { intellisense } from '../../src/tools/intellisense.js';
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
    registerToolCommands(ctx, catalog, profiles, async () => registry, async () => {}, async () => [{ name: physical.id, brief: physical.description, totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', totalCalls: 0 }]);
    const agentContext = new Context();
    agentContext.provide('commandNamespaces', { isPtc: () => true } as unknown as Context['commandNamespaces']);
    const execution = { agent: { id: 'session', ctx: agentContext, session: Session.create(SessionId('session')) }, signal: new AbortController().signal } as ToolRunContext;
    const call = (name: string, args: unknown = {}) => definitions.get(name)!.execute(args, execution);
    return { definitions, registry, catalog, call };
}

test('native Profile data tools and optional-name save/load use session defaults', async () => {
    const { definitions, call, registry } = await fixture();
    assert.deepEqual([...definitions.keys()].sort(), ['tools_profile_annotation', 'tools_profile_commands', 'tools_profile_delete', 'tools_profile_load', 'tools_profile_profiles', 'tools_profile_save']);
    assert.equal(await call('tools_profile_annotation'), profileAnnotation);
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Default'], selected: 'Default' });
    assert.deepEqual(await call('tools_profile_commands'), [{ name: 'read_file', brief: 'Read a file.', totalCalls: 2 }, { name: 'outside_scope', brief: 'Outside this session.', totalCalls: 0 }]);
    const profile = JSON.parse(JSON.stringify(profileTree('Ignored', { ...registry.configuration(), namespaces: [{ path: 'files', description: '', alwaysVisible: true }], mappings: [{ id: 'read_file', path: 'files.read', aliases: [], pinned: false, alwaysVisible: 2 }], toolComments: { read_file: 'Read text' } }))); 
    await call('tools_profile_save', { profile });
    assert.deepEqual(JSON.parse(JSON.stringify(await call('tools_profile_load'))), { ...profile, name: 'Default' });
    await call('tools_profile_save', { name: 'Copy', profile });
    assert.equal(registry.snapshot().profile, 'Copy');
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Copy', 'Default'], selected: 'Copy' });
    await call('tools_profile_load', { name: 'Default' });
    assert.equal(registry.snapshot().profile, 'Default');
});

test('manifest exposes only the new tools API and projects VM array arguments', async () => {
    const { definitions, registry } = await fixture();
    registry.refresh([...definitions.values()].map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema } )).concat([
        { id: 'tools_intellisense', description: 'Inspect commands.', parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] }, output: { type: 'string' } },
        { id: 'tools_mount', description: 'Old command.', parameters: {}, output: {} },
    ]));
    const entries = manifest(registry, []);
    assert.deepEqual(entries.commands().filter(entry => entry.deployment === 'tool').map(entry => entry.path).sort(), ['tools.intellisense', 'tools.profile.annotation', 'tools.profile.commands', 'tools.profile.delete', 'tools.profile.load', 'tools.profile.profiles', 'tools.profile.save']);
    const discovery = entries.commands().find(entry => entry.path === 'tools.intellisense')!;
    assert.deepEqual(await positionalArguments(discovery, ['files.']), { queries: ['files.'] });
    await assert.rejects(positionalArguments(discovery, [['files.']]));
    assert.deepEqual(await positionalArguments(entries.commands().find(entry => entry.path === 'tools.profile.save')!, [{ name: 'Default', root: {} }]), { profile: { name: 'Default', root: {} } });
    const vm = intellisense(['tools.profile.', 'tools.profile.save', 'tools.intellisense'], entries, true);
    assert(vm.includes('readonly annotation: string'));
    assert(vm.includes('readonly profiles: Profiles'));
    assert(vm.includes('save(profile: Profile)'));
    assert(vm.includes('function intellisense(...args: string[])'));
    const native = intellisense(['tools.profile.annotation'], entries, false);
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
    const { call, catalog, registry } = await fixture();
    const profile = await call('tools_profile_load');
    for (const args of [{}, { profile: undefined }, { profile: {} }, { name: null, profile }, { name: 42, profile }]) {
        await assert.rejects(call('tools_profile_save', args));
    }
    assert.deepEqual(catalog.snapshot().profiles, ['Default']);
    await call('tools_profile_save', { name: 'Copy', profile });
    const updated = { ...profile, name: 'Ignored', root: { ...profile.root, children: [...profile.root.children, {
        type: 'tree', name: 'business', permissions: profile.root.permissions, children: [],
    }] } };
    await call('tools_profile_save', { profile: updated });
    assert.equal(registry.snapshot().profile, 'Copy');
    assert(catalog.configuration('Copy').namespaces.some(node => node.path === 'business'));
    assert(!catalog.configuration('Default').namespaces.some(node => node.path === 'business'));
    assert.deepEqual(catalog.snapshot().profiles, ['Copy', 'Default']);
});


test('Profile deletion rejects the current selection and missing entries, and can remove the catalog default', async () => {
    const { call, catalog, registry } = await fixture();
    await assert.rejects(call('tools_profile_delete'), /Current Profile cannot be deleted: Default/);
    await assert.rejects(call('tools_profile_delete', { name: 'Default' }), /Current Profile cannot be deleted: Default/);
    await assert.rejects(call('tools_profile_delete', { name: 'Missing' }), /Profile does not exist/);
    const profile = await call('tools_profile_load');
    await call('tools_profile_save', { name: 'Copy', profile });
    await assert.rejects(call('tools_profile_delete', { name: 'Copy' }), /Current Profile cannot be deleted: Copy/);
    await call('tools_profile_delete', { name: 'Default' });
    assert.deepEqual(await call('tools_profile_profiles'), { profiles: ['Copy'], selected: 'Copy' });
    assert.equal(registry.snapshot().profile, 'Copy');
    assert.equal(catalog.snapshot().profile, 'Copy');
    await assert.rejects(call('tools_profile_delete', { name: 'Default' }), /Profile does not exist/);
});
