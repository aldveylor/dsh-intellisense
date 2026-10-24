import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeHost } from '../../src/runtime/host.js';

test('VM deletes global after installing tool namespaces and preloaded values', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        for (const paths of [[], ['global.read', 'std.read']]) {
            const result = await host.execute('global-namespace', 'inspect', `
                let deleted = false;
                try { global; } catch (error) { deleted = error instanceof ReferenceError; }
                return [typeof global, deleted, typeof tools.profile.annotation, typeof globalThis];
            `, paths, async () => null, new AbortController().signal, {
                'global.value': 1, 'tools.profile.annotation': { type: 'object' },
            });
            assert.equal(result.error, undefined);
            assert.deepEqual(result.value, ['undefined', true, 'object', 'undefined']);
        }
    } finally { await host.dispose(); }
});
