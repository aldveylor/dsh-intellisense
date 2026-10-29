import { Context } from '@deepseek-ai/cordis';
import { NamespaceComponent } from '../../src/profile/component.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../src/storage/store.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableFunction } from '../../src/profile/function.js';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ToolAdditions } from '../../src/integration/tool_additions/tool_additions.js';

/** @brief Create a fresh live session with an identity that can be reopened after restart. */
function session(id: string): Session { return Session.create(SessionId(id)); }

test('catalog saves allocate immutable anonymous versions while sessions retain old numeric pointers', async () => {
    const state = new MemoryStore();
    const history = new MemoryStore();
    const catalog = new SemanticRegistry(state, 'global', undefined, history);
    const sessions = new ProfileSessions(new NamespaceComponent(new Context(), catalog), state);
    const first = await sessions.addition(session('first'));
    const second = await sessions.addition(session('second'));
    assert.equal(first.profile.pointer, second.profile.pointer);
    const original = first.profile.pointer;
    await catalog.saveProfile('Default', { ...catalog.configuration(), namespaces: [{ path: 'updated', description: 'New version', alwaysVisible: false }] }, { trusted: true });
    const latest = await catalog.reference();
    assert(latest.pointer > original);
    assert.equal(first.profile.pointer, original);
    assert.equal(first.profile.snapshot.resolve('updated'), undefined);
    assert.equal(latest.snapshot.resolve('updated')?.type, 'namespace');
    const detached = latest.snapshot;
    detached.create('private', () => new EditableNamespace());
    assert.equal(latest.snapshot.resolve('private'), undefined);
    const saved = await state.load<{ profiles: Record<string, { pointer: number }> }>('registry');
    assert.equal(saved?.profiles.Default!.pointer, latest.pointer);
    assert.equal('root' in saved!, false);
    const entries = await history.loadEntries<Record<string, unknown>>('profile_snapshot_');
    assert(entries.filter(([key]) => /_\d+$/.test(key)).every(([, value]) => !Object.hasOwn(value, 'name')));
    const restoredCatalog = new SemanticRegistry(state, 'global', undefined, history);
    await restoredCatalog.load();
    const reopened = await new ProfileSessions(new NamespaceComponent(new Context(), restoredCatalog), state).addition(session('first'));
    assert.equal(reopened.profile.pointer, original);
    assert.equal(reopened.profile.snapshot.resolve('updated'), undefined);
    assert.equal((await restoredCatalog.reference()).pointer, latest.pointer);
});

test('session snapshots are immutable and switch archives an existing global pointer exactly once', async () => {
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const sessions = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const parentSession = session('parent');
    const parent = await sessions.addition(parentSession);
    const child = await sessions.addition(session('child'), async () => parent);
    assert.equal(parent.profile, child.profile);
    const initial = parent.profile.pointer;
    const draft = parent.profile.snapshot;
    draft.create('files', () => new EditableNamespace()).create('read', () => new EditableFunction()).setTool('read');
    assert.equal(parent.profile.snapshot.resolve('files'), undefined);
    await parent.save();
    assert.equal(parent.profile.pointer, initial);
    assert.throws(() => { Object.assign(parent, { profile: child.profile }); }, TypeError);
    await catalog.saveProfile('Default', { ...catalog.configuration(), namespaces: [{ path: 'latest', description: 'Latest', alwaysVisible: false }] }, { trusted: true });
    const firstUnreferenced = await catalog.reference();
    await assert.rejects(catalog.snapshots.get(firstUnreferenced.pointer), /Unknown Profile snapshot/);
    await catalog.saveProfile('Default', { ...catalog.configuration(), namespaces: [{ path: 'latest', description: 'Latest again', alwaysVisible: false }] }, { trusted: true });
    const latest = await catalog.reference();
    assert(latest.pointer > firstUnreferenced.pointer);
    await assert.rejects(catalog.snapshots.get(latest.pointer), /Unknown Profile snapshot/);
    await sessions.load(parentSession, 'Default');
    assert.equal(parent.profile.pointer, latest.pointer);
    assert.equal(child.profile.pointer, initial);
    assert.equal(await catalog.snapshots.get(latest.pointer), parent.profile);
    const archiveCount = (await store.loadEntries('profile_snapshot_')).filter(([key]) => /_\d+$/.test(key)).length;
    await sessions.load(parentSession, 'Default');
    assert.equal(parent.profile.pointer, latest.pointer);
    assert.equal((await store.loadEntries('profile_snapshot_')).filter(([key]) => /_\d+$/.test(key)).length, archiveCount);
    await assert.rejects(catalog.snapshots.get(firstUnreferenced.pointer), /Unknown Profile snapshot/);
    const persisted = (await store.loadEntries<{ name: string; pointer: number }>('profile_session_')).map(([, value]) => value);
    assert(persisted.every(value => Object.keys(value).sort().join(',') === 'name,pointer'));
});

test('concurrent publication uses unique pointers and failed switch retains the current reference', async () => {
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const original = await catalog.reference();
    const versions = await Promise.all(Array.from({ length: 8 }, () => catalog.snapshots.create(original.snapshot)));
    assert.equal(new Set(versions.map(version => version.pointer)).size, 8);
    assert(versions.every(version => version.pointer > original.pointer));
    const sessions = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const live = session('failure');
    const current = await sessions.addition(live);
    const previous = current.profile;
    await catalog.saveProfile('Next', catalog.configuration(), { trusted: true });
    const save = store.save.bind(store);
    store.save = async (key, value) => { if (key.startsWith('profile_session_')) throw new Error('Session unavailable'); await save(key, value); };
    await assert.rejects(sessions.load(live, 'Next'), /Session unavailable/);
    assert.equal(current.profile, previous);
    store.save = save;
    await sessions.load(live, 'Next');
    assert(current.profile.pointer > versions.at(-1)!.pointer);
});

test('tool additions contain metadata while concrete command classes own builtin behavior', async () => {
    const additions = new ToolAdditions();
    const first = additions.set('read', { ptcDescription: 'First' });
    const second = additions.set('read', { hidden: true, ptcDescription: 'Second' });
    assert.deepEqual(additions.get('read'), { hidden: true, ptcDescription: 'Second' });
    second();
    assert.deepEqual(additions.get('read'), { ptcDescription: 'First' });
    first();
    assert.deepEqual(additions.get('read'), {});
    assert.throws(() => additions.set('read', { fixed: true } as never), /Invalid tool addition/);
    const catalog = new SemanticRegistry(new MemoryStore());
    const inspect = (await catalog.reference()).snapshot.resolve('tools.inspect');
    assert.equal(inspect?.type, 'function');
    assert.equal((inspect as import('../../src/profile/function.js').ProfileFunction).discovery, true);
    assert.equal('setToolAddition' in catalog.definitions, false);
    assert.equal('addition' in catalog.definitions, false);
});

test('parallel switches bind pointer checks and archive writes under one lock', async () => {
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const sessions = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const firstSession = session('parallel_first');
    const secondSession = session('parallel_second');
    const first = await sessions.addition(firstSession);
    const second = await sessions.addition(secondSession);
    const previous = first.profile.pointer;
    await catalog.saveProfile('Next', catalog.configuration(), { trusted: true });
    const next = await catalog.reference('Next');
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const save = store.save.bind(store);
    let archives = 0;
    store.save = async (key, value) => {
        if (key === `profile_snapshot_${next.pointer}`) { archives++; entered(); await gate; }
        await save(key, value);
    };
    const a = sessions.load(firstSession, 'Next');
    await writing;
    const b = sessions.load(secondSession, 'Next');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(first.profile.pointer, previous);
    assert.equal(second.profile.pointer, previous);
    assert.equal(archives, 1);
    release();
    await Promise.all([a, b]);
    assert.equal(archives, 1);
    assert.equal(first.profile, second.profile);
    assert.equal(first.profile.pointer, next.pointer);
    const restored = new SemanticRegistry(store);
    await restored.load();
    assert.equal((await restored.reference('Next')).pointer, next.pointer);
    const reopened = await new ProfileSessions(new NamespaceComponent(new Context(), restored), store).addition(session('parallel_first'));
    assert.equal(reopened.profile.pointer, next.pointer);
});


test('changing the global factory never adds nodes to an existing session version', async () => {
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const sessions = new ProfileSessions(new NamespaceComponent(new Context(), catalog), store);
    const current = await sessions.addition(session('factory_change'));
    const reference = current.profile;
    const before = reference.snapshot.serialize();
    const factory = catalog.definitions.createInitialProfile;
    catalog.definitions.createInitialProfile = () => {
        const root = factory();
        root.create('later', () => new EditableNamespace()).setPermissions({ removable: false });
        return root;
    };
    assert.equal(reference.snapshot.resolve('later'), undefined);
    assert.deepEqual(reference.snapshot.serialize(), before);
    assert.equal(current.profile, reference);
});
