import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Profile, ProfileSchema, profileConfiguration, profileTree } from '../../src/registry/profile_tree.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Include protected nodes, all pin levels and a physical command mounted at independent paths. */
function fixture() {
    const current = new SemanticRegistry(new MemoryStore()).configuration();
    const configuration = { ...current,
        mappings: [...['read', 'write', 'list'].map((id, index) => ({ id, path: `files.${id}`, pinned: false, alwaysVisible: (2 - index) as 0 | 1 | 2 })), { id: 'read', path: 'read', pinned: false, alwaysVisible: 2 as const }],
        namespaces: [{ path: 'files', description: 'File operations', alwaysVisible: true }],
        namespaceVisible: { tools: true }, builtinVisible: { 'tools.profile.load': 2 as const, 'tools.inspect': 2 as const }, toolComments: { read: 'Read text' } };
    return { current, profile: profileTree('Work', configuration), commands: ['read', 'write', 'list'].map(name => ({ name, brief: name, paths: [], totalCalls: 0 })) };
}

test('Profile trees round-trip nested namespaces, independent mounts, comments and all command pin levels', () => {
    const { current, profile, commands } = fixture();
    const before = current.save();
    const configuration = profileConfiguration(ProfileSchema.parse(profile), current, commands);
    assert.deepEqual(current.save(), before);
    assert.deepEqual(configuration.mappings.map(mapping => mapping.alwaysVisible), [2, 1, 0, 2]);
    assert.deepEqual(configuration.mappings.filter(mapping => mapping.id === 'read').map(mapping => mapping.path), ['files.read', 'read']);
    assert.equal(configuration.namespaces[0]?.description, 'File operations');
    assert.equal(configuration.namespaces[0]?.alwaysVisible, true);
    assert.equal(configuration.namespaceVisible?.tools, false);
    assert.equal(profile.root.children!['tools'].fixedLevel, undefined);
    assert.equal(configuration.builtinVisible?.['tools.profile.load'], 2);
    assert.deepEqual(profileTree('Work', configuration), profile);
});

test('Profile schema rejects invalid nodes and configuration restores missing protected children', () => {
    const { current, profile, commands } = fixture();
    for (const input of [{ name: 'Work', root: {} }, { ...profile, extra: true },
        { ...profile, root: { ...profile.root, fixedLevel: 3 } }]) assert.equal(ProfileSchema.safeParse(input).success, false);
    assert.throws(() => profileConfiguration(profile, current, []), /Unknown command: read/);
    const missing = structuredClone(profile);
    delete missing.root.children!['tools'];
    assert(Object.hasOwn(profileTree('Work', profileConfiguration(missing, current, commands)).root.children!, 'tools'));
    const replaced = structuredClone(profile);
    replaced.root.children!['tools'].children!['inspect'].command!.tool = 'read';
    assert.throws(() => profileConfiguration(replaced, current, []), /Protected command cannot be replaced/);
});


test('Profile members use record keys and reject redundant names and array children', () => {
    const { profile } = fixture();
    assert.equal('name' in profile.root, false);
    assert.equal('name' in profile.root.children!['files']!, false);
    assert.equal('name' in profile.root.children!['files']!.children!['read']!, false);
    assert.equal(ProfileSchema.safeParse({ ...profile, root: { ...profile.root, name: '' } }).success, false);
    assert.equal(ProfileSchema.safeParse({ ...profile, root: { ...profile.root, children: [] } }).success, false);
    profile.root.children!['files']!.children!['read'] = { type: 'command', command: { tool: 'write' } };
    assert.equal(ProfileSchema.parse(profile).root.children!['files']!.children!['read']!.command!.tool, 'write');
});

test('protected diagnostics reject rename and move while omissions restore protected nodes', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['tools']) {
        const renamed = structuredClone(profile);
        renamed.root.children!['term'] = renamed.root.children![name]!;
        delete renamed.root.children![name];
        assert.throws(() => profileConfiguration(renamed, current, commands), new RegExp(`Node cannot be renamed: ${name} -> term.*permissions.renamable=false`));
        const moved = structuredClone(profile);
        const original = moved.root.children![name];
        delete moved.root.children![name];
        moved.root.children!['nested'] = { type: 'namespace', permissions: profile.root.permissions, children: { [name]: original! } };
        assert.throws(() => profileConfiguration(moved, current, commands), new RegExp(`Node cannot be moved: ${name} -> nested.${name}.*permissions.movable=false`));
        const removed = structuredClone(profile);
        delete removed.root.children![name];
        removed.root.permissions = { ...removed.root.permissions, removable: true };
        assert(Object.hasOwn(profileTree('Work', profileConfiguration(removed, current, commands)).root.children!, name));
    }
    const renamedLeaf = structuredClone(profile);
    const members = renamedLeaf.root.children!['tools']!.children!;
    members.detail = members.inspect!;
    delete members.inspect;
    assert.throws(() => profileConfiguration(renamedLeaf, current, commands), /Node cannot be renamed: tools.inspect -> tools.detail/);
});

test('root info and log namespaces coexist with protected tools without a console namespace', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['info', 'log']) profile.root.children![name] = { type: 'namespace', permissions: profile.root.permissions, children: {} };
    const configuration = profileConfiguration(profile, current, commands);
    assert(configuration.namespaces.some(node => node.path === 'info'));
    assert(configuration.namespaces.some(node => node.path === 'log'));
    const children = profileTree('Work', configuration).root.children!;
    assert(Object.hasOwn(children, 'tools'));
    assert(!Object.hasOwn(children, 'console'));
});


test('save fills protected descendants without replacing submitted pin and disabled settings', () => {
    const { current } = fixture();
    current.builtinVisible = { 'tools.profile.load': 2, 'tools.profile.save': 1, 'tools.search': 2 };
    current.builtinDisabled = ['tools.profile.delete'];
    const full = profileTree('Work', current);
    const input = structuredClone(full);
    input.root.children = { ['tools']: input.root.children!['tools']! };
    const tools = input.root.children!['tools']!;
    const profile = tools.children!['profile'];
    profile.fixedLevel = 0;
    profile.disabled = true;
    profile.children = { ['load']: profile.children!['load']! };
    profile.children!['load']!.fixedLevel = 0;
    const before = structuredClone(input);
    const restored = profileTree('Work', profileConfiguration(ProfileSchema.parse(input), current, []));
    assert.deepEqual(input, before);
    const result = restored.root.children!['tools'].children!['profile'];
    assert.equal(result.fixedLevel, undefined);
    assert.equal(result.disabled, true);
    assert.equal(result.children!['load'].fixedLevel, undefined);
    assert.equal(result.children!['save'].fixedLevel, 1);
    assert.equal(result.children!['delete'].disabled, true);
    assert.equal(restored.root.children!['tools'].children!['search'].fixedLevel, 2);
    delete tools.children!['profile'];
    const missingNamespace = profileTree('Work', profileConfiguration(input, current, []));
    assert.equal(missingNamespace.root.children!['tools'].children!['profile'].children!['load'].fixedLevel, 2);
});


test('save permits omitted briefs and ignores forged edits of protected descriptions', () => {
    const { current, profile, commands } = fixture();
    const tools = profile.root.children!['tools'];
    tools.description = 'Forged namespace brief';
    tools.permissions = { ...tools.permissions, commentable: true };
    const save = tools.children!['profile'].children!['save'];
    save.command!.doc = 'Forged command brief';
    save.description = 'Forged leaf description';
    assert.equal(ProfileSchema.safeParse(profile).success, false, 'Command nodes reject namespace-only fields');
    delete save.description;
    save.permissions = { ...save.permissions, commentable: true };
    const files = profile.root.children!['files'];
    for (const leaf of Object.values(files.children!)) delete leaf.command!.doc;
    // The additional read mount also omits its brief, so it cannot accidentally supply an override.
    delete profile.root.children!['read'].command!.doc;
    const configuration = profileConfiguration(ProfileSchema.parse(profile), current, commands);
    assert.deepEqual(configuration.toolComments, {});
    const saved = profileTree('Work', configuration);
    const savedTools = saved.root.children!['tools'];
    assert.equal(savedTools.permissions.commentable, false);
    assert.notEqual(savedTools.description, 'Forged namespace brief');
    const savedCommand = savedTools.children!['profile'].children!['save'];
    assert.equal(savedCommand.permissions.commentable, false);
    assert.notEqual(savedCommand.command!.doc, 'Forged command brief');
});


test('Profile command contracts reject removed argument mappings', () => {
    const { profile } = fixture();
    const files = profile.root.children!['files'];
    const command = files.children!['read']!;
    assert(command.type === 'command');
    const invalid = { ...command, command: { ...command.command, argMap: { filename: 'path' } } };
    files.children!['read'] = invalid;
    assert.equal(ProfileSchema.safeParse(profile).success, false);
});

test('Profile constructors preserve editable tree data and detach saved and restored trees', () => {
    const { current, profile, commands } = fixture();
    assert(profile instanceof Profile);
    const data = profile.save();
    assert.equal(Object.getPrototypeOf(data), Object.prototype);
    assert.deepEqual(ProfileSchema.parse(data), data);
    const restored = new Profile(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(restored, profile);
    data.root.children = {};
    assert(Object.keys(restored.root.children!).length > 0);
    const files = restored.root.children!['files'];
    files.description = 'Restored files';
    assert.equal(profile.root.children!['files'].description, 'File operations');
    assert.equal(profileConfiguration(restored, current, commands).namespaces[0]!.description, 'Restored files');
    assert(ProfileSchema.safeParse(new Profile().save()).success);
});


test('Profile brief survives schema, tree conversion and detached persistence', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.load();
    const configuration = { ...registry.configuration(), brief: '日常开发工具' };
    const profile = profileTree('开发', configuration);
    assert.equal(ProfileSchema.parse(profile.save()).brief, configuration.brief);
    assert.equal(new Profile(profile.save()).brief, configuration.brief);
    const restored = profileConfiguration(profile, registry.configuration(), []);
    assert.equal(restored.save().brief, configuration.brief);
    await registry.saveProfile('开发', restored);
    const reloaded = new SemanticRegistry(store);
    await reloaded.load();
    assert.equal(reloaded.configuration('开发').brief, configuration.brief);
    assert.deepEqual(reloaded.profileBriefs(), { '开发': configuration.brief });
    await reloaded.saveProfile('开发', { ...restored, brief: undefined });
    assert.equal(reloaded.configuration('开发').save().brief, undefined);
    assert.deepEqual(reloaded.profileBriefs(), {});
});


test('selecting or deleting a described default does not leak its brief into an undescribed Profile', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    await registry.load();
    await registry.saveProfile('Default', { ...registry.configuration(), brief: 'General tools' });
    await registry.saveProfile('Empty', { ...registry.configuration(), brief: undefined });
    await registry.manageProfile('select', 'Empty', registry.snapshot().revision);
    assert.equal(registry.configuration().brief, undefined);
    await registry.manageProfile('select', 'Default', registry.snapshot().revision);
    assert.equal(registry.configuration().brief, 'General tools');
    await registry.manageProfile('delete', 'Default', registry.snapshot().revision);
    assert.equal(registry.configuration().brief, undefined);
});
