import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { SessionRuntime } from '../../src/runtime/session.js';
import { orderedPaths, namespacePaths } from '../../src/web/namespace_tree.js';

test('root commands generate callable declarations and execute through the normal mapping dispatcher', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read_file', description: 'Read file contents', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, output: { type: 'string' } }]);
    await registry.configure([{ id: 'read_file', path: 'read', aliases: ['files.read'], enabled: true, pinned: false, alwaysVisible: true }], 0);
    const calls: string[] = [];
    const runtime = new SessionRuntime((path, args) => registry.invoke(path, args, async (id, value) => {
        calls.push(id); return (value as { path: string }).path;
    }));
    runtime.update({ declarations: registry.declarations(), paths: registry.effective().flatMap(m => [m.path, ...m.aliases]) });
    assert.match(registry.declarations(), /declare const read: \(args:/);
    assert.equal(runtime.validate('await read({path: "root"})'), undefined);
    assert.deepEqual((await runtime.execute('root', 'await read({path: "root"})')).output, 'root');
    assert.deepEqual(calls, ['read_file']);
    assert(registry.namespaceVisibility().some(hint => hint.startsWith('read —')));
    await assert.rejects(registry.configure([{ ...registry.snapshot().mappings[0]!, path: 'Promise', aliases: [] }], 1), /reserved/);
});

test('save and reload preserve explicit mixed order and stable order for previously unranked nodes', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store);
    registry.refresh([{ id: 'read', description: '', parameters: { type: 'object' }, output: { type: 'string' } }]);
    const mappings = [{ id: 'read', path: 'read', aliases: [], enabled: true, pinned: false }];
    const namespaces = [{ path: 'zeta', alwaysVisible: false, description: '' }, { path: 'alpha', alwaysVisible: false, description: '' }];
    assert.deepEqual(orderedPaths(['zeta', 'alpha', 'read'], []), ['zeta', 'alpha', 'read']);
    await registry.configure(mappings, 0, namespaces, ['zeta', 'read', 'alpha']);
    const restored = new SemanticRegistry(store); await restored.load(); restored.refresh(registry.tools());
    const state = restored.snapshot();
    assert.deepEqual(orderedPaths([...namespacePaths({ mappings: state.mappings, namespaces: state.namespaces! }), 'read'], state.order!), ['zeta', 'read', 'alpha']);
    await restored.configure(mappings, 1, namespaces.map(n => ({ ...n, description: 'Edited' })), state.order);
    assert.deepEqual(restored.snapshot().order, ['zeta', 'read', 'alpha']);
});
