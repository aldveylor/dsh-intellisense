import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, type Store } from '../../src/storage/store.js';
import { SemanticRegistry, type Mapping } from '../../src/registry/registry.js';

const physical = [{ id: 'read-file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, output: { type: 'string' } }];
const mapping = (extra: Partial<Mapping> = {}): Mapping => ({ id: 'read-file', path: 'std.fs.read', aliases: [], enabled: true, authorized: false, pinned: false, ...extra });

test('unknown identities are stable, denied and never automatically classified', async () => {
    const registry = new SemanticRegistry(new MemoryStore()); registry.refresh(physical);
    const first = registry.effective()[0]!.path;
    registry.refresh(physical);
    assert.equal(registry.effective()[0]!.path, first); assert.match(first, /^unknown\.t_/);
    await assert.rejects(registry.invoke(first, { path: 'x' }, async () => 'bad'), /denied/);
});

test('mapping, invocation validation, independent authorization and statistics', async () => {
    const store = new MemoryStore(); const registry = new SemanticRegistry(store); registry.refresh(physical);
    await registry.configure([mapping()], 0);
    assert.match(registry.declarations(), /Promise<string>/);
    await assert.rejects(registry.invoke('std.fs.read', { path: 'a' }, async () => 'a'), /denied/);
    await registry.configure([mapping({ authorized: true, aliases: ['files.read'] })], 1);
    await assert.rejects(registry.invoke('std.fs.read', { path: 3 }, async () => 'bad'), /Invalid arguments/);
    await registry.expose(['std.fs.read']);
    assert.equal(registry.snapshot().usage['read-file']!.calls, 0);
    assert.equal(await registry.invoke('files.read', { path: 'a' }, async () => 'ok'), 'ok');
    assert.equal(registry.snapshot().usage['read-file']!.calls, 1);
    assert.equal(registry.snapshot().usage['read-file']!.exposures, 1);
    const loaded = new SemanticRegistry(store); await loaded.load(); loaded.refresh(physical);
    assert.equal(loaded.effective()[0]!.path, 'std.fs.read');
});

test('pinned and stable paths survive proposals; stale and hostile proposals reject atomically', async () => {
    const registry = new SemanticRegistry(new MemoryStore()); registry.refresh(physical);
    await registry.configure([mapping({ pinned: true })], 0);
    await assert.rejects(registry.applyProposal({ revision: 1, changes: [{ id: 'read-file', path: 'other.read' }] }), /Stable/);
    await assert.rejects(registry.configure([mapping({ path: '__proto__.read' })], 1), /reserved/);
    await assert.rejects(registry.configure([mapping({ aliases: ['std.fs.read.child'] })], 1), /collision/);
    await assert.rejects(registry.configure([mapping()], 0), /revision/);
    assert.equal(registry.snapshot().revision, 1);
});

test('new organization mappings stay unauthorized and persistence failures do not partially commit', async () => {
    const registry = new SemanticRegistry(new MemoryStore()); registry.refresh(physical);
    await registry.applyProposal({ revision: 0, changes: [{ id: 'read-file', path: 'std.fs.read' }] });
    assert.equal(registry.snapshot().mappings[0]!.authorized, false);
    const broken: Store = { load: async () => undefined, save: async () => { throw new Error('disk unavailable'); } };
    const other = new SemanticRegistry(broken); other.refresh(physical);
    await assert.rejects(other.configure([mapping()], 0), /disk/);
    assert.equal(other.snapshot().revision, 0);
});

test('same-revision concurrent updates have exactly one commit', async () => {
    const registry = new SemanticRegistry(new MemoryStore()); registry.refresh(physical);
    const outcomes = await Promise.allSettled([registry.configure([mapping()], 0), registry.configure([mapping({ path: 'other.read' })], 0)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
});


test('namespace hints retain call history and respect visibility and enabled mappings', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    const tools = [...physical, { ...physical[0]!, id: 'write-file' }];
    registry.refresh(tools);
    await registry.configure([mapping({ authorized: true, aliases: ['files.read'] }), mapping({ id: 'write-file', path: 'std.fs.write', authorized: true })], 0);
    await registry.invoke('files.read', { path: 'a' }, async () => 'ok');
    await registry.invoke('std.fs.read', { path: 'a' }, async () => 'ok');
    await registry.invoke('std.fs.write', { path: 'b' }, async () => 'ok');
    const saved = await store.load<import('../../src/registry/registry.js').RegistryState>('registry');
    saved!.usage['write-file']!.lastUsed = saved!.usage['read-file']!.lastUsed + 1;
    await store.save('registry', saved);
    const loaded = new SemanticRegistry(store); await loaded.load(); loaded.refresh(tools);
    assert.equal(loaded.namespaceHints().frequent[0], 'std.fs.read');
    assert.equal(loaded.namespaceHints().recent[0], 'std.fs.write');
    assert(loaded.namespaceHints().frequent.includes('files.read'));
    assert.deepEqual(loaded.namespaceHints(new Set(['write-file'])), { frequent: ['std.fs.write'], recent: ['std.fs.write'] });
    await loaded.configure([mapping({ enabled: false }), mapping({ id: 'write-file', path: 'std.fs.write', enabled: false })], 1);
    assert.deepEqual(loaded.namespaceHints(), { frequent: [], recent: [] });
});
