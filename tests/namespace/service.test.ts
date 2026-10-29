import { sessionFor } from '../registry/session_fixture.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { EditableCommand } from '../../src/registry/profile/command.js';
import { EditableNamespace } from '../../src/registry/profile/namespace.js';
import type { ProfileNamespace } from '../../src/registry/profile/namespace.js';
import type { ProfileCommand } from '../../src/registry/profile/command.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolsNamespace } from '../../src/namespace/service.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { manifest } from '../../src/namespace/namespace.js';
import { EditableSnapshot } from '../../src/registry/profile/snapshot.js';
import { RootNamespace } from '../../src/tools/profile_nodes/root_namespace.js';
import { ImplToolsNamespace } from '../../src/tools/profile_nodes/impl_tools_namespace.js';
import { ImplToolsInspectCommand } from '../../src/tools/profile_nodes/impl_tools_inspect_command.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { profileConfiguration, profileTree } from '../../src/registry/profile_tree.js';
import { MemoryStore } from '../../src/storage/store.js';
import { unmountedTools } from '../../src/web/panel/tree_provider.js';

/** @brief Read the discriminator before narrowing a generic member. */
function namespaceNode(node: import('../../src/registry/profile/node.js').ProfileNode | undefined): ProfileNamespace {
    assert.equal(node?.type, 'namespace');
    return node as ProfileNamespace;
}

/** @brief Read the discriminator before narrowing a generic command member. */
function commandNode(node: import('../../src/registry/profile/node.js').ProfileNode | undefined): ProfileCommand {
    assert.equal(node?.type, 'command');
    return node as ProfileCommand;
}

/** @brief Use portable interfaces against real persistence and namespace projection. */
function fixture() {
    const ctx = new Context();
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    registry.refresh([{ id: 'read', description: 'Native read documentation', parameters: { type: 'object', properties: {} }, output: {} }]);
    const component = new NamespaceComponent(ctx, registry);
    const service: ToolsNamespace = component;
    const sessions = new NamespaceIntegration(ctx, component, new ProfileSessions(registry, store));
    return { store, registry, component, service, sessions };
}

test('default Profiles contain concrete builtin implementations and independent anonymous snapshots', async () => {
    const { service } = fixture();
    const initial = await service.create('Development');
    assert(initial instanceof RootNamespace);
    assert(initial.get('tools') instanceof ImplToolsNamespace);
    assert(namespaceNode(initial.get('tools')).get('inspect') instanceof ImplToolsInspectCommand);
    assert.equal((await service.get('Development'))!.children.size, 1);
    assert.equal('name' in initial, false);
    assert.equal('root' in initial, false);
    assert.equal('commit' in initial, false);
    initial.create('files', () => new EditableNamespace('files')).create('read', () => new EditableCommand('read')).setTool('read');
    assert.equal((await service.get('Development'))!.children.size, 1);
    assert.throws(() => initial.create('files', () => new EditableNamespace('files')), /already exists/);
    assert.equal(initial.getOrCreate('files', () => new EditableNamespace('files')).type, 'namespace');
    assert.throws(() => initial.create('files.read', () => new EditableNamespace('files.read')), /Invalid Profile member/);
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
        const files = snapshot.create('files', () => new EditableNamespace('files')).setDescription('File operations');
        files.create('read', () => new EditableCommand('read')).setTool('read').setFixedLevel(2).setPermissions({ removable: false });
        files.setPermissions({ acceptsChildren: false });
        return snapshot;
    });
    assert.equal(registry.profileSelection().selected, 'Default');
    assert.equal(commandNode(namespaceNode(value.get('files')).get('read')).tool, 'read');
    assert.equal(commandNode(namespaceNode(value.get('files')).get('read')).permissions.removable, false);
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
        service.edit('Shared', snapshot => { snapshot.create('first', () => new EditableCommand('first')).setTool('read'); return snapshot; }),
        service.edit('Shared', snapshot => { snapshot.create('second', () => new EditableCommand('second')).setTool('read'); return snapshot; }),
    ]);
    assert.deepEqual([...(await service.get('Shared'))!.children.keys()], ['tools', 'first', 'second']);
    const replacement = (await service.create('Replacement')).setBrief('Replacement tree');
    replacement.create('replacement', () => new EditableCommand('replacement')).setTool('read');
    await service.edit('Shared', () => replacement);
    assert.deepEqual([...(await service.get('Shared'))!.children.keys()], ['tools', 'replacement']);
    assert.equal((await service.get('Shared'))!.brief, 'Replacement tree');
});

test('failed modifiers, validation and persistence leave the entire Profile unchanged', async () => {
    const { store, service, registry } = fixture();
    await service.create('Work');
    const before = registry.configuration('Work').save();
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('read', () => new EditableCommand('read')).setTool('read'); throw new Error('Abort edit'); }), /Abort edit/);
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('unbound', () => new EditableCommand('unbound')); return snapshot; }), /no physical tool/);
    assert.deepEqual(registry.configuration('Work').save(), before);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(service.edit('Work', snapshot => { snapshot.create('read', () => new EditableCommand('read')).setTool('read'); return snapshot; }), /Disk failed/);
    assert.deepEqual(registry.configuration('Work').save(), before);
    store.save = save;
    await service.edit('Work', snapshot => { snapshot.create('read', () => new EditableCommand('read')).setTool('read'); return snapshot; });
    assert.equal((await service.get('Work'))!.children.size, 2);
});

test('conversation snapshot modification stays independent from its named catalog Profile', async () => {
    const { service, registry, sessions } = fixture();
    await service.create('Work');
    const session = await sessions.profiles.load(sessionFor(sessions.profiles, 'session'), 'Work');
    sessions.registryFor = async () => session;
    sessions.configurationChanged = async () => {};
    await sessions.edit({ id: 'session', session: sessionFor(sessions.profiles, 'session') } as Agent, snapshot => { snapshot.create('read', () => new EditableCommand('read')).setTool('read'); return snapshot; });
    assert.equal(session.configuration().mappings.length, 1);
    assert.equal(registry.configuration('Work').mappings.length, 0);
});

test('fixed tools reject user mounts but allow plugin-owned mounts and reversible attribute layers', async () => {
    const { service, registry } = fixture();
    const unregister = registry.definitions.setToolAddition('read', { fixed: true });
    const extra = registry.definitions.setToolAddition('read', { ptcDescription: 'PTC read documentation' });
    assert.equal(registry.definitions.addition('read').fixed, true);
    await assert.rejects(registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision), /Fixed tool cannot be mounted/);
    await service.create('Plugin');
    await service.edit('Plugin', snapshot => { snapshot.create('read', () => new EditableCommand('read')).setTool('read'); return snapshot; });
    const snapshot = (await service.get('Plugin'))!;
    assert.equal(commandNode(snapshot.get('read')).tool, 'read');
    assert.equal(unmountedTools(registry.tools(), []).length, 0);
    extra();
    assert.deepEqual(registry.definitions.addition('read'), { fixed: true });
    unregister();
    assert.deepEqual(registry.definitions.addition('read'), {});
});

test('hidden transports and custom hidden tools disappear without hiding fixed discovery tools', async () => {
    const { registry } = fixture();
    registry.refresh(['read', 'tools_inspect', 'exec', 'run_code', 'tools_run_code'].map(id => ({ id, description: id, parameters: {}, output: {} })));
    assert.deepEqual(registry.tools().map(tool => tool.id), ['read', 'tools_inspect']);
    const unregister = registry.definitions.setToolAddition('read', { hidden: true });
    assert.deepEqual(registry.tools().map(tool => tool.id), ['tools_inspect']);
    await assert.rejects(registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision), /cannot be mounted/);
    unregister();
    assert.equal(registry.tools()[0]!.id, 'read');
});

test('PTC comments override physical documentation only in PTC and restore after disposal', async () => {
    const { registry } = fixture();
    await registry.configure([{ id: 'read', path: 'files.read', pinned: false }], registry.revision);
    const unregister = registry.definitions.setToolAddition('read', { ptcDescription: 'PTC read documentation' });
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'PTC read documentation');
    assert.equal(manifest(registry, [], 'native').commands()[0]!.doc, 'Native read documentation');
    unregister();
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Native read documentation');
});

test('builtin namespaces are explicitly installed with edit and custom permissions reject untrusted changes', async () => {
    const { service, registry } = fixture();
    await service.create('Plugin');
    assert.equal((await service.get('Plugin'))!.children.size, 1);
    assert((await service.get('Plugin'))!.get('tools'));
    await service.edit('Plugin', snapshot => {
        snapshot.create('files', () => new EditableNamespace('files')).create('read', () => new EditableCommand('read')).setTool('read').setPermissions({ removable: false, commentable: false });
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
    const { registry, sessions } = fixture();
    const dispose = registry.definitions.setToolAddition('read', {
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
    const restoreDescription = registry.definitions.setToolAddition('read', { ptcDescription: 'Layered PTC description' });
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Layered PTC description');
    assert.equal(manifest(registry, [], 'native').commands()[0]!.doc, 'Provider projection');
    restoreDescription();
    assert.equal(manifest(registry, [], 'ptc').commands()[0]!.doc, 'Provider projection');
    assert.deepEqual(await sessions.values(), { 'external.data': { source: 'provider' } });
    dispose();
    assert.deepEqual(await sessions.values(), {});
});


test('tools namespace implementations block child mutation independently of displayed permissions', () => {
    const { service } = fixture();
    const root = service.createInitialProfile();
    const tools = namespaceNode(root.get('tools'));
    assert(tools instanceof ImplToolsNamespace);
    assert.throws(() => tools.setPermissions({ acceptsChildren: true }), /permissions cannot be changed/);
    assert.throws(() => tools.create('extra', () => new EditableCommand('extra')), /does not accept children/);
    assert.throws(() => tools.remove('inspect'), /cannot be removed/);
    const exposed = tools.children as Map<string, unknown>;
    exposed.clear();
    assert(tools.get('inspect'));
});

test('collection factory initializes every new Profile and hydration preserves edits and concrete types', async () => {
    const { service } = fixture();
    let calls = 0;
    service.createInitialProfile = () => {
        calls++;
        const profile = new RootNamespace();
        profile.create('custom', () => new EditableNamespace('custom'));
        return profile;
    };
    await service.create('Factory');
    await service.edit('Factory', value => { value.create('added', () => new EditableNamespace('added')); return value; });
    const restored = (await service.get('Factory'))!;
    assert(restored instanceof RootNamespace);
    assert(restored.get('custom'));
    assert(restored.get('added'));
    assert(namespaceNode(restored.get('tools')).get('inspect') instanceof ImplToolsInspectCommand);
    assert(calls > 0);
    service.createInitialProfile = () => new EditableSnapshot();
    assert.equal((await service.create('Empty')).children.size, 0);
});

/** @brief A factory-declared namespace carries its implementation identity through persistence and cloning. */
class FactoryNamespace extends EditableNamespace {
    readonly factoryMarker = true;
}

test('node factories take no arguments and return their exact supplied type and identity', () => {
    const root = new RootNamespace();
    const supplied = new FactoryNamespace('custom');
    let calls = 0;
    const created = root.create('custom', (...args: unknown[]) => { assert.equal(args.length, 0); calls++; return supplied; });
    assert.equal(created.factoryMarker, true);
    assert.equal(created, supplied);
    assert.equal(root.get('custom'), supplied);
    assert.equal(root.getOrCreate('custom', () => { calls++; return new FactoryNamespace('other'); }), supplied);
    assert.equal(calls, 1);
    const another = new FactoryNamespace('another');
    root.set('another', another);
    assert.equal(root.get('another'), another);
    const clone = root.clone();
    assert(clone.get('custom') instanceof FactoryNamespace);
    assert.notEqual(clone.get('custom'), supplied);
});

test('factory-declared node subclasses survive collection reads and independent edits', async () => {
    const { service } = fixture();
    service.createInitialProfile = () => {
        const profile = new RootNamespace();
        profile.create('declared', () => new FactoryNamespace('declared'));
        return profile;
    };
    await service.create('Typed');
    await service.edit('Typed', snapshot => {
        const node = snapshot.get('declared');
        assert.equal(node?.type, 'namespace');
        assert(node instanceof FactoryNamespace);
        node.create('read', () => new EditableCommand('read')).setTool('read');
        return snapshot;
    });
    const snapshot = (await service.get('Typed'))!;
    assert(snapshot.get('declared') instanceof FactoryNamespace);
    assert(namespaceNode(snapshot.get('declared')).get('read'));
});


test('RootNamespace cannot alias its tools node or move its protected descendants through generic set', () => {
    const root = new RootNamespace();
    const tools = root.get('tools')!;
    assert.throws(() => root.set('alias', tools), /cannot be renamed/);
    const ordinary = root.create('ordinary', () => new EditableNamespace('ordinary'));
    assert.throws(() => ordinary.set('tools', tools), /cannot be moved/);
    const inspect = namespaceNode(tools).get('inspect')!;
    assert.throws(() => ordinary.set('inspect', inspect), /cannot be moved/);
    assert.equal(root.get('tools'), tools);
    assert.equal(root.get('alias'), undefined);
    assert.equal(ordinary.get('tools'), undefined);
});


test('snapshot resolve returns only enabled physical names without service execution interfaces', async () => {
    const { service, registry } = fixture();
    await service.create('Work');
    await service.edit('Work', snapshot => {
        snapshot.create('files', () => new EditableNamespace('files')).create('read', () => new EditableCommand('read')).setTool('read');
        return snapshot;
    });
    const snapshot = (await service.get('Work'))!;
    assert.equal(snapshot.resolve('files.read'), 'read');
    assert.equal(snapshot.resolve('global.files.read'), 'read');
    for (const path of ['files', '', 'files.', 'files.read.', 'files.missing', '__proto__.read']) assert.equal(snapshot.resolve(path), undefined);
    assert.equal(registry.profileSelection().selected, 'Default');
    assert.equal('dispatch' in service, false);
    assert.equal('dispatchTool' in service, false);
    assert.equal('registryFor' in service, false);
    for (const member of ['resolve', 'searchEngines', 'statistics', 'setToolAddition', 'setNamespaceImplementation', 'values', 'commandBriefs', 'profileNames']) assert.equal(member in service, false);
    namespaceNode(snapshot.get('files')).setDisabled(true);
    assert.equal(snapshot.resolve('files.read'), undefined);
    namespaceNode(snapshot.get('files')).setDisabled(false);
    commandNode(namespaceNode(snapshot.get('files')).get('read')).setDisabled(true);
    assert.equal(snapshot.resolve('files.read'), undefined);
    const editable = (await service.get('Work'))!;
    editable.create('unbound', () => new EditableCommand('unbound'));
    assert.equal(editable.resolve('files.read'), 'read');
    assert.equal(editable.resolve('unbound'), undefined);
});
