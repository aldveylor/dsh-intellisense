import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry, type Mapping } from '../../src/registry/registry.js';
import { SessionRegistries } from '../../src/registry/session_registry.js';
import { MemoryStore } from '../../src/storage/store.js';

const tool = { id: 'read', description: 'Read files', parameters: { type: 'object' }, output: { type: 'string' } };

/** @brief Build one mapped path without coupling tests to the UI's naming controls. */
function mapping(path: string): Mapping {
    return { id: tool.id, path, aliases: [], enabled: true, pinned: false };
}

test('new sessions copy the current global configuration and remain independent', async () => {
    const store = new MemoryStore();
    const global = new SemanticRegistry(store); global.refresh([tool]);
    await global.configure([mapping('files.read')], 0, [{ path: 'files', alwaysVisible: true, description: 'Files' }]);
    await global.invoke('files.read', {}, async () => 'contents');
    const sessions = new SessionRegistries(global, store);
    const first = await sessions.get('first');
    assert.deepEqual(first.snapshot().mappings, global.snapshot().mappings);
    assert.deepEqual(first.snapshot().namespaces, global.snapshot().namespaces);
    assert.deepEqual(first.snapshot().usage, {});

    await global.configure([mapping('shared.read')], 1, []);
    const second = await sessions.get('second');
    assert.equal(first.effective()[0]!.path, 'files.read');
    assert.equal(second.effective()[0]!.path, 'shared.read');
    await first.configure([mapping('personal.read')], 0, []);
    assert.equal(global.effective()[0]!.path, 'shared.read');
    assert.equal(second.effective()[0]!.path, 'shared.read');
});

test('concurrent allocation shares one registry and persisted sessions survive release and restart', async () => {
    const store = new MemoryStore();
    const global = new SemanticRegistry(store); global.refresh([tool]);
    const sessions = new SessionRegistries(global, store);
    const [first, same] = await Promise.all([sessions.get('one'), sessions.get('one')]);
    assert.equal(first, same);
    await first.configure([mapping('personal.read')], 0, []);
    sessions.release('one');
    const restored = await new SessionRegistries(global, store).get('one');
    assert.equal(restored.effective()[0]!.path, 'personal.read');
    assert.equal(restored.snapshot().revision, 1);
    global.refresh([]);
    assert.deepEqual((await sessions.get('one')).tools(), []);
});

test('failed allocation can retry without replacing another session configuration', async () => {
    const backing = new MemoryStore();
    let fail = true;
    const store = {
        load: <T>(key: string) => backing.load<T>(key),
        save: async <T>(key: string, value: T) => {
            if (fail) { fail = false; throw new Error('Storage unavailable'); }
            await backing.save(key, value);
        },
    };
    const global = new SemanticRegistry(backing); global.refresh([tool]);
    const sessions = new SessionRegistries(global, store);
    await assert.rejects(sessions.get('one'), /Storage unavailable/);
    const recovered = await sessions.get('one');
    assert.equal(recovered.effective()[0]!.path, 'unknown.read');
});
