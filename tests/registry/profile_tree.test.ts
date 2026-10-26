import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSchema, profileConfiguration, profileTree } from '../../src/registry/profile_tree.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Include protected nodes, all pin levels and a shared physical command alias. */
function fixture() {
    const current = new SemanticRegistry(new MemoryStore()).configuration();
    const configuration = { ...current,
        mappings: ['read', 'write', 'list'].map((id, index) => ({ id, path: `files.${id}`, aliases: id === 'read' ? ['read'] : [], pinned: false, alwaysVisible: (2 - index) as 0 | 1 | 2 })),
        namespaces: [{ path: 'files', description: 'File operations', alwaysVisible: true }],
        namespaceVisible: { console: true }, builtinVisible: { 'console.log': 2 as const, 'tools.intellisense': 2 as const }, toolComments: { read: 'Read text' } };
    return { current, profile: profileTree('Work', configuration), commands: ['read', 'write', 'list'].map(name => ({ name, brief: name })) };
}

test('Profile trees round-trip nested namespaces, aliases, comments and all command pin levels', () => {
    const { current, profile, commands } = fixture();
    const before = structuredClone(current);
    const configuration = profileConfiguration(ProfileSchema.parse(profile), current, commands);
    assert.deepEqual(current, before);
    assert.deepEqual(configuration.mappings.map(mapping => mapping.alwaysVisible), [2, 1, 0]);
    assert.deepEqual(configuration.mappings[0]?.aliases, ['read']);
    assert.equal(configuration.namespaces[0]?.description, 'File operations');
    assert.equal(configuration.namespaceVisible?.console, true);
    assert.equal(configuration.builtinVisible?.['console.log'], 2);
    assert.deepEqual(profileTree('Work', configuration), profile);
});

test('Profile schema rejects invalid nodes and configuration rejects missing or replaced protected children', () => {
    const { current, profile } = fixture();
    for (const input of [{ name: 'Work', root: {} }, { ...profile, extra: true },
        { ...profile, root: { ...profile.root, fixedLevel: 3 } }]) assert.equal(ProfileSchema.safeParse(input).success, false);
    assert.throws(() => profileConfiguration(profile, current, []), /Unknown command: read/);
    const missing = structuredClone(profile);
    missing.root.children = missing.root.children!.filter(node => node.name !== 'tools');
    assert.throws(() => profileConfiguration(missing, current, []), /Node cannot be removed: tools/);
    const replaced = structuredClone(profile);
    replaced.root.children!.find(node => node.name === 'tools')!.children!.find(node => node.name === 'intellisense')!.command!.tool = 'read';
    assert.throws(() => profileConfiguration(replaced, current, []), /Protected command cannot be replaced/);
});


test('duplicate diagnostics identify the complete path and both submitted sources', () => {
    const { current, profile, commands } = fixture();
    const files = profile.root.children!.find(node => node.name === 'files')!;
    files.children!.push({ ...structuredClone(files.children![0]!), command: { ...files.children![0]!.command!, tool: 'write' } });
    assert.throws(() => profileConfiguration(profile, current, commands), /Duplicate namespace member: root.files.read; root.files.children\[0\] \(read\) conflicts with root.files.children\[3\] \(write\)/);
});

test('protected diagnostics distinguish rename, move and removal while rejecting forged permissions', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['console', 'tools']) {
        const renamed = structuredClone(profile);
        renamed.root.children!.find(node => node.name === name)!.name = 'term';
        assert.throws(() => profileConfiguration(renamed, current, commands), new RegExp(`Node cannot be renamed: ${name} -> term.*permissions.renamable=false`));
        const moved = structuredClone(profile);
        const original = moved.root.children!.find(node => node.name === name)!;
        moved.root.children = moved.root.children!.filter(node => node.name !== name);
        moved.root.children.push({ type: 'tree', name: 'nested', permissions: profile.root.permissions, children: [original] });
        assert.throws(() => profileConfiguration(moved, current, commands), new RegExp(`Node cannot be moved: ${name} -> nested.${name}.*permissions.movable=false`));
        const removed = structuredClone(profile);
        removed.root.children = removed.root.children!.filter(node => node.name !== name);
        removed.root.permissions.removable = true;
        assert.throws(() => profileConfiguration(removed, current, commands), new RegExp(`Node cannot be removed: ${name}.*permissions.removable=false`));
    }
    const renamedLeaf = structuredClone(profile);
    renamedLeaf.root.children!.find(node => node.name === 'console')!.children!.find(node => node.name === 'info')!.name = 'detail';
    assert.throws(() => profileConfiguration(renamedLeaf, current, commands), /Node cannot be renamed: console.info -> console.detail/);
});

test('root info and log namespaces coexist with the protected console methods', () => {
    const { current, profile, commands } = fixture();
    for (const name of ['info', 'log']) profile.root.children!.push({ type: 'tree', name, permissions: profile.root.permissions, children: [] });
    const configuration = profileConfiguration(profile, current, commands);
    assert(configuration.namespaces.some(node => node.path === 'info'));
    assert(configuration.namespaces.some(node => node.path === 'log'));
    assert(profileTree('Work', configuration).root.children!.some(node => node.name === 'console'));
});
