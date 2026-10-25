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
