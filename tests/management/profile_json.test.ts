import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileJson } from '../../src/management/profile_picker/profile_json.js';

test('Profile JSON round trip retains all configuration and unavailable tool mappings', () => {
    const profile = {
        mappings: [{ id: 'unavailable', path: 'files.read', pinned: false, disabled: true, alwaysVisible: 2, description: '读取文件' }],
        namespaces: [{ path: 'files', description: 'Files', alwaysVisible: true, disabled: true }],
        order: ['tools', 'console', 'files', 'files.read'],
        unmountedVisible: { search: 1 }, builtinVisible: { 'tools.search': 2 },
        builtinDisabled: ['tools.search'], namespaceVisible: { console: true }, toolComments: { unavailable: 'Read' },
    };
    assert.deepEqual(parseProfileJson(JSON.stringify(profile, null, 2)), profile);
    assert.deepEqual(parseProfileJson('\uFEFF' + JSON.stringify(profile)), profile);
});

test('Profile JSON rejects malformed files and metadata outside the configuration', () => {
    const profile = { mappings: [], namespaces: [], order: [], unmountedVisible: {}, builtinVisible: {}, namespaceVisible: {}, toolComments: {} };
    for (const text of ['{', 'null', '[]', '{}', JSON.stringify({ ...profile, revision: 4 }),
        JSON.stringify({ ...profile, mappings: [{ id: 'read', path: 'read', pinned: false, alwaysVisible: 3 }] }),
        JSON.stringify({ ...profile, namespaceVisible: { console: 'true' } })]) {
        assert.throws(() => parseProfileJson(text));
    }
    assert.deepEqual(parseProfileJson(JSON.stringify(profile)), profile);
});
