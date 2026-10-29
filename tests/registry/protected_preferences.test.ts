import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';
import { sessionFor } from './session_fixture.js';

test('archived builtin restrictions survive global edits and restart', async () => {
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const sessions = new ProfileSessions(catalog, store);
    const session = await sessions.addition(sessionFor(sessions, 'protected'));
    const original = session.profile.pointer;
    await catalog.saveProfile('Default', { ...catalog.configuration(), builtinDisabled: ['tools'], builtinVisible: { 'tools.profile.load': 2 } }, { trusted: true });
    assert.equal(session.profile.pointer, original);
    assert.equal(session.profile.snapshot.resolve('tools.inspect')?.type, 'command');
    const restoredCatalog = new SemanticRegistry(store);
    await restoredCatalog.load();
    const restoredSessions = new ProfileSessions(restoredCatalog, store);
    const restored = await restoredSessions.addition(sessionFor(restoredSessions, 'protected'));
    const inspect = restored.profile.snapshot.resolve('tools.inspect')!;
    assert.equal(inspect.permissions.removable, false);
    assert.deepEqual(inspect.permissions.availableFixLevels, [2]);
    await restoredSessions.load(sessionFor(restoredSessions, 'protected'), 'Default');
    assert.equal(restored.profile.snapshot.resolve('tools.inspect'), undefined);
});
