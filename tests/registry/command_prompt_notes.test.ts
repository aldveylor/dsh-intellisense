import { promptFor } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type Mapping } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { manifest } from '../namespace/fixtures.js';
import { inspect } from '../namespace/fixtures.js';

test('custom pinned briefs preserve original Inspect documentation at every pin level', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Original command documentation', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path' } }, required: ['path'] }, output: { type: 'string' } }]);
    const mapping: Mapping = { id: 'read', path: 'files.read', pinned: false };
    for (const level of [0, 1, 2] as const) {
        await registry.configure([{ ...mapping, alwaysVisible: level, description: 'Custom prompt note' }], registry.snapshot().revision);
        const hint = await promptFor(registry);
        assert.equal(hint.includes('namespace files'), level > 0);
        if (level === 1) {
            assert.match(hint, /Custom prompt note/);
            assert(!hint.includes('Original command documentation'));
        }
        if (level === 2) {
            assert.match(hint, /@brief Custom prompt note/);
            assert.match(hint, /function read\(path: string\)/);
        }
        const info = inspect(['files.read'], manifest(registry, []));
        assert.match(info, /Original command documentation/);
        assert(!info.includes('Custom prompt note'));
    }
    registry.refresh([]);
    assert(!(await promptFor(registry)).includes('namespace files'));
});
