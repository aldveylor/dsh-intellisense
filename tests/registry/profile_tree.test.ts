import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSchema, profileConfiguration, profileTree, type Profile } from '../../src/registry/profile_tree.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Include every command pin level, a nested namespace and a shared physical command alias. */
function profile(): Profile {
    return { name: 'Work', root: { type: 'namespace', fixed: false, children: {
        files: { type: 'namespace', fixed: true, children: {
            read: { type: 'command', command: 'read', fixedLevel: 'fixed-detail', simplifiedBrief: 'Read text' },
            write: { type: 'command', command: 'write', fixedLevel: 'fixed-brief' },
            list: { type: 'command', command: 'list', fixedLevel: 'none' },
        } },
        read: { type: 'command', command: 'read', fixedLevel: 'fixed-detail', simplifiedBrief: 'Read text' },
    } } };
}

test('Profile trees round-trip nested namespaces, aliases, comments and all command pin levels', () => {
    const registry = new SemanticRegistry(new MemoryStore());
    const current = { ...registry.configuration(), namespaces: [{ path: 'files', description: 'File operations', alwaysVisible: false }], consolePinned: true, builtinVisible: { 'console.log': 2 as const } };
    const commands = ['read', 'write', 'list'].map(name => ({ name, brief: name }));
    const before = structuredClone(current);
    const configuration = profileConfiguration(ProfileSchema.parse(profile()), current, commands);
    assert.deepEqual(current, before);
    assert.deepEqual(configuration.mappings.map(mapping => mapping.alwaysVisible), [2, 1, 0]);
    assert.deepEqual(configuration.mappings[0]?.aliases, ['read']);
    assert.equal(configuration.namespaces[0]?.description, 'File operations');
    assert.equal(configuration.consolePinned, true);
    assert.deepEqual(configuration.builtinVisible, { 'console.log': 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(profileTree('Work', configuration))), profile());
});

test('Profile schema rejects missing discriminators, invalid pin levels and unknown properties', () => {
    for (const input of [
        { name: 'Work', root: {} },
        { ...profile(), extra: true },
        { name: 'Work', root: { type: 'namespace', fixed: false, children: { read: { type: 'command', command: 'read', fixedLevel: 'fixed' } } } },
    ]) assert.equal(ProfileSchema.safeParse(input).success, false);
    const registry = new SemanticRegistry(new MemoryStore());
    const current = registry.configuration();
    const before = structuredClone(current);
    assert.throws(() => profileConfiguration(profile(), current, []), /Unknown command: read/);
    assert.deepEqual(current, before);
});
