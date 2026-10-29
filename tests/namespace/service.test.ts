import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolsNamespace } from '../../src/namespace/service.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { manifest, createNamespace, NamespaceNode, CommandNode } from '../../src/namespace/namespace.js';
import { registerBuiltinProfile } from '../../src/namespace/builtin_profile.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { profileConfiguration, profileTree } from '../../src/registry/profile_tree.js';
import { MemoryStore } from '../../src/storage/store.js';
import { unmountedTools } from '../../src/web/panel/tree_provider.js';

/** @brief Use portable interfaces against real persistence and namespace projection. */
function fixture() {
    const ctx = new Context();
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    registry.refresh([{ id: 'read', description: 'Native read documentation', parameters: { type: 'object', properties: {} }, output: {} }]);
    const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), []);
    const service: ToolsNamespace = component;
    return { store, registry, component, service };
}

test('Profiles start empty and get returns anonymous independent snapshots without persistence methods', async () => {
    const { service } = fixture();
    const initial = await service.create('Development');
    assert.equal(initial.children.size, 0);
    assert.equal((await service.get('Development'))!.children.size, 0);
    assert.equal('name' in initial, false);
    assert.equal('root' in initial, false);
    assert.equal('commit' in initial, false);
    initial.create('files').create('read', 'command').setTool('read');
    assert.equal((await service.get('Development'))!.children.size, 0);
    assert.throws(() => initial.create('files'), /already exists/);
    assert.throws(() => initial.getOrCreate('files', 'command'), /type mismatch/);
    assert.throws(() => initial.create('files.read'), /Invalid Profile member/);
});

test('list returns independent name arrays and remove persists in collection submission order', async () => {
    const { service, registry, store } = fixture();
    assert.deepEqual(await service.list(), ['Default']);
    await Promise.all([service.create('Work'), service.remove('Work'), service.getOrCreate('Other')]);
    assert.deepEqual(await service.list(), ['Default', 'Other']);
    assert.equal(await service.get('Work'), undefined);
    const names = await service.list();
    names.length = 0;
    assert.deepEqual(await service.list(), ['Default', 'Other']);
    await service.remove('Default');
    assert.equal(registry.profileSelection().selected, 'Other');
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert.deepEqual(restored.profileSelection(), { profiles: ['Other'], selected: 'Other' });
    await assert.rejects(service.remove('Other'), /profile_required/);
    await assert.rejects(service.remove('Missing'), /does not exist/);
    assert.deepEqual(await service.list(), ['Other']);
});

test('failed removal preserves the catalog and subsequent collection operations still succeed', async () => {
    const { service, store } = fixture();
    await service.create('Work');
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(service.remove('Work'), /Disk failed/);
    assert.deepEqual(await service.list(), ['Default', 'Work']);
    assert(await service.get('Work'));
    store.save = save;
    await service.remove('Work');
    assert.deepEqual(await service.list(), ['Default']);
});

test('edit publishes a complete recursive snapshot and preserves explicit permissions across restart', async () => {
    const { service, registry, store } = fixture();
    await service.create('Development');
    const value = await service.edit('Development', snapshot => {
        snapshot.setBrief('Development tools');
        const files = snapshot.create('files').setDescription('File operations').setPermissions({ acceptsChildren: false });
        files.create('read', 'command').setTool('read').setFixedLevel(2).setPermissions({ removable: false });
        return snapshot;
    });
    assert.equal(registry.profileSelection().selected, 'Default');
    assert.equal(value.get('files', 'namespace')!.get('read', 'command')!.tool, 'read');
    assert.equal(value.get('files', 'namespace')!.get('read', 'command')!.permissions.removable, false);
    assert(!Object.hasOwn(value.serialize().children!, 'files.read'));
    const restored = new SemanticRegistry(store);
    await restored.load();
    const tree = profileTree('Development', restored.configuration('Development'), restored.definitions).root;
    assert.equal(tree.children!.files.children!.read.permissions!.removable, false);
    assert.equal(tree.children!.files.permissions!.acceptsChildren, false);
});

test('get-or-create is atomic and modifiers run in order against the latest committed snapshot', async () => {
    const { service } = fixture();
    await Promise.all([service.getOrCreate('Shared'), service.getOrCreate('Shared')]);
    await assert.rejects(service.create('Shared'), /profile_name_exists/);
    await Promise.all([
        service.edit('Shared', snapshot => { snapshot.create('first', 'command').setTool('read'); return snapshot; }),
        service.edit('Shared', snapshot => { snapshot.create('second', 'command').setTool('read'); return snapshot; }),
    ]);
    assert.deepEqual([...(await service.get('Shared'))!.children.keys()], ['first', 'second']);
    const replacement = (await service.create('Replacement')).setBrief('Replacement tree');
    replacement.create('replacement', 'command').setTool('read');
    await service.edit('Shared', () => replacement);
    assert.deepEqual([...(await service.get('Shared'))!.children.keys()], ['replacement']);
    assert.equal((await service.get('Shared'))!.brief, 'Replacement tree');
});

test('failed modifiers, validation and persistence leave the entire Profile unchanged', async () => {
    const { store, service, registry } = fixture();
    await service.create('Work');
    const before = registry.configuration('Work').save();
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('read', 'command').setTool('read'); throw new Error('Abort edit'); }), /Abort edit/);
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('unbound', 'command'); return snapshot; }), /no physical tool/);
    assert.deepEqual(registry.configuration('Work').save(), before);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('read', 'command').setTool('read'); return snapshot; }), /Disk failed/);
    assert.deepEqual(registry.configuration('Work').save(), before);
    store.save = save;
    await service.edit('Work', snapshot => { snapshot.create('read', 'command').setTool('read'); return snapshot; });
    assert.equal((await service.get('Work'))!.children.size, 1);
});

test('conversation snapshot modification stays independent from its named catalog Profile', async () => {
    const { service, registry, component } = fixture();
    await service.create('Work');
    const session = new SemanticRegistry(new MemoryStore(), 'session', registry.definitions);
    await session.replaceConfiguration(registry.configuration('Work'), 'Work');
    component.registryFor = async () => session;
    component.configurationChanged = async () => {};
    await service.edit({ agent: {} as Agent }, snapshot => { snapshot.create('read', 'command').setTool('read'); return snapshot; });
    assert.equal(session.configuration().mappings.length, 1);
    assert.equal(registry.configuration('Work').mappings.length, 0);
});

test('fixed tools reject user mounts but allow plugin-owned mounts and reversible attribute layers', async () => {
    const { service, registry } = fixture();
    const unregister = service.setToolAddition('read', { fixed: true });
    const extra = service.setToolAddition('read', { ptcDescription: 'PTC read documentation' });
    assert.equal(registry.definitions.addition('read').fixed, true);
    await assert.rejects(registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision), /Fixed tool cannot be mounted/);
    await service.create('Plugin');
    await service.edit('Plugin', snapshot => { snapshot.create('read', 'command').setTool('read'); return snapshot; });
    const snapshot = (await service.get('Plugin'))!;
    assert.equal(snapshot.get('read', 'command')!.tool, 'read');
    assert.equal(unmountedTools(registry.tools(), []).length, 0);
    extra();
    assert.deepEqual(registry.definitions.addition('read'), { fixed: true });
    unregister();
    assert.deepEqual(registry.definitions.addition('read'), {});
});

test('hidden transports and custom hidden tools disappear without hiding fixed discovery tools', async () => {
    const { service, registry } = fixture();
    registry.refresh(['read', 'tools_inspect', 'exec', 'run_code', 'tools_run_code'].map(id => ({ id, description: id, parameters: {}, output: {} })));
    assert.deepEqual(registry.tools().map(tool => tool.id), ['read', 'tools_inspect']);
    const unregister = service.setToolAddition('read', { hidden: true });
    assert.deepEqual(registry.tools().map(tool => tool.id), ['tools_inspect']);
    await assert.rejects(registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision), /cannot be mounted/);
    unregister();
    assert.equal(registry.tools()[0]!.id, 'read');
});

test('PTC comments override physical documentation only in PTC and restore after disposal', async () => {
    const { service, registry } = fixture();
    await registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision);
    const unregister = service.setToolAddition('read', { ptcDescription: 'PTC read documentation' });
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'PTC read documentation');
    assert.equal(manifest(registry, [], 'native').commands()[0]!.doc, 'Native read documentation');
    unregister();
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Native read documentation');
});

test('builtin namespaces are explicitly installed with edit and custom permissions reject untrusted changes', async () => {
    const { service, registry } = fixture();
    await service.create('Plugin');
    assert.equal((await service.get('Plugin'))!.children.size, 0);
    await registerBuiltinProfile(service, 'Plugin');
    assert((await service.get('Plugin'))!.get('tools'));
    await service.edit('Plugin', snapshot => {
        snapshot.create('files').create('read', 'command').setTool('read').setPermissions({ removable: false, commentable: false });
        return snapshot;
    });
    const current = registry.configuration('Plugin');
    const input = profileTree('Plugin', current, registry.definitions).save();
    const commands = [{ name: 'read', brief: '', paths: [], totalCalls: 0 }];
    delete input.root.children!.files.children!.read;
    assert.throws(() => profileConfiguration(input, current, commands, registry.definitions), /cannot be removed: files.read/);
    const forged = profileTree('Plugin', current, registry.definitions).save();
    forged.root.children!.files.children!.read.permissions = { removable: true, commentable: true };
    forged.root.children!.files.children!.read.command!.doc = 'Forged';
    assert.throws(() => profileConfiguration(forged, current, commands, registry.definitions), /documentation cannot be changed/);
});

test('ordinary providers register callable projections and preloaded values at arbitrary paths', async () => {
    const { service, component, registry } = fixture();
    const dispose = service.setToolAddition('read', {
        project: () => ({ signature: '(value: string) => Promise<void>', description: 'Provider projection', positional: [['value']], discardResult: true }),
        value: { read: async () => ({ source: 'provider' }), refresh: 'call' },
    });
    await registry.configure([{ id: 'read', path: 'external.data', pinned: false }], registry.revision);
    const command = manifest(registry, []).commands()[0]!;
    assert.equal(command.constructor.name, 'CommandNode');
    assert.equal(command.permissions.removable, true);
    assert.equal(command.signature, '(value: string) => Promise<void>');
    assert.deepEqual(command.binding().parameters, { kind: 'overloads', layouts: [['value']] });
    assert.deepEqual(command.binding().result, { kind: 'discard' });
    assert.equal(command.result('discarded'), undefined);
    const restoreDescription = service.setToolAddition('read', { ptcDescription: 'Layered PTC description' });
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Layered PTC description');
    assert.equal(manifest(registry, [], 'native').commands()[0]!.doc, 'Provider projection');
    restoreDescription();
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Provider projection');
    assert.deepEqual(await component.values(), { 'external.data': { source: 'provider' } });
    dispose();
    assert.deepEqual(await component.values(), {});
});


test('tools namespace implementations block child mutation independently of displayed permissions', () => {
    const { registry } = fixture();
    const definition = registry.definitions.tree();
    definition.children!.tools!.permissions = { acceptsChildren: true, removable: true };
    definition.children!.tools!.children!.inspect!.permissions = { removable: true };
    const root = createNamespace({ tools: [], includeUnavailable: true, definitions: definition,
        implementation: path => registry.definitions.implementation(path) });
    const tools = root.resolve(['tools']) as NamespaceNode;
    assert.equal(tools.constructor.name, 'ImplToolsNamespace');
    assert.equal(tools.permissions.acceptsChildren, true);
    assert.throws(() => tools.add(new CommandNode('extra', tools, { tool: 'read', schema: {}, doc: '' })), /does not accept children/);
    assert.throws(() => tools.remove('inspect'), /cannot be removed/);
    (tools.children as Map<string, NamespaceNode | CommandNode>).clear();
    assert(tools.resolve(['inspect']));
});
