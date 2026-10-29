import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileDocument, ProfileSchema, profileConfiguration, profileTree } from '../../src/registry/profile_tree.js';
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

test('Profile schema rejects invalid nodes and configuration rejects missing protected children', () => {
    const { current, profile, commands } = fixture();
    for (const input of [{ name: 'Work', root: {} }, { ...profile, extra: true },
        { ...profile, root: { ...profile.root, fixedLevel: 3 } }]) assert.equal(ProfileSchema.safeParse(input).success, false);
    assert.throws(() => profileConfiguration(profile, current, []), /Unknown command: read/);
    const missing = structuredClone(profile);
    delete missing.root.children!['tools'];
    assert.throws(() => profileConfiguration(missing, current, commands), /Node cannot be removed: tools/);
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

test('protected diagnostics reject rename and move and removal', () => {
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
        assert.throws(() => profileConfiguration(removed, current, commands), /Node cannot be removed: tools/);
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


test('save rejects missing protected descendants and forbidden documentation or pin edits', () => {
    const { current, profile, commands } = fixture();
    for (const edit of [
        (value: typeof profile) => { delete value.root.children!['tools'].children!['profile'].children!['save']; },
        (value: typeof profile) => { value.root.children!['tools'].description = 'Forged'; },
        (value: typeof profile) => { value.root.children!['tools'].children!['inspect'].command!.doc = 'Forged'; },
        (value: typeof profile) => { delete value.root.children!['tools'].children!['inspect'].command!.doc; },
        (value: typeof profile) => { value.root.children!['tools'].children!['inspect'].fixedLevel = 0; },
    ]) {
        const input = new ProfileDocument(profile.save());
        edit(input);
        const before = input.save();
        assert.throws(() => profileConfiguration(input, current, commands), /Node (cannot be removed|documentation cannot be changed|fixed level cannot be changed)/);
        assert.deepEqual(input.save(), before);
    }
});


test('Profile schema rejects empty, invalid and JavaScript convention keys before parsing records', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['', '$evil', 'bad.name', 'bad-name', '__proto__', 'constructor', 'prototype', 'then', 'toString', 'hasOwnProperty', '__defineGetter__', '__dsh_internal']) {
        const input = profile.save();
        input.root.children = JSON.parse(JSON.stringify({ ...input.root.children, [name]: { type: 'namespace' } }));
        assert.equal(ProfileSchema.safeParse(input).success, false, name);
        assert.throws(() => profileConfiguration(input, current, commands), undefined, name);
    }
});


test('ordinary namespaces may share protected member names without replacing protected objects', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['inspect', 'save', 'load', 'tools', 'profile']) {
        const input = profile.save();
        input.root.children!['custom'] = { type: 'namespace', children: { [name]: { type: 'namespace' } } };
        const configuration = profileConfiguration(input, current, commands);
        assert(configuration.namespaces.some(node => node.path === `custom.${name}`));
        assert.deepEqual(profileTree('Work', configuration).root.children!['tools'], profile.root.children!['tools']);
    }
    const input = profile.save();
    input.root.children!['tools'].children!['inspect'] = { type: 'namespace' };
    assert.throws(() => profileConfiguration(input, current, commands), /Protected node cannot be replaced/);
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
    assert(profile instanceof ProfileDocument);
    const data = profile.save();
    assert.equal(Object.getPrototypeOf(data), Object.prototype);
    assert.deepEqual(ProfileSchema.parse(data), data);
    const restored = new ProfileDocument(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(restored, profile);
    data.root.children = {};
    assert(Object.keys(restored.root.children!).length > 0);
    const files = restored.root.children!['files'];
    files.description = 'Restored files';
    assert.equal(profile.root.children!['files'].description, 'File operations');
    assert.equal(profileConfiguration(restored, current, commands).namespaces[0]!.description, 'Restored files');
    assert(ProfileSchema.safeParse(new ProfileDocument().save()).success);
});


test('Profile brief survives schema, tree conversion and detached persistence', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.load();
    const configuration = { ...registry.configuration(), brief: '日常开发工具' };
    const profile = profileTree('开发', configuration);
    assert.equal(ProfileSchema.parse(profile.save()).brief, configuration.brief);
    assert.equal(new ProfileDocument(profile.save()).brief, configuration.brief);
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
