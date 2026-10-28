import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { MemoryStore } from '../../src/storage/store.js';
import { CommandStatistics } from '../../src/namespace/statistics.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { inspectQueryTargets, registerInspect } from '../../src/tools/inspect.js';
import { namespace } from './fixtures.js';

test('concurrent session updates preserve global totals and durable detached snapshots', async () => {
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    await statistics.load();
    await Promise.all(Array.from({ length: 30 }, (_, index) => statistics.recordCall(index % 2 ? 'first' : 'second', 'read')));
    await statistics.recordQueries('first', [{ path: 'std', namespace: true }, { path: 'std.read', namespace: false }]);
    const snapshot = await statistics.snapshot();
    assert.equal(snapshot.calls, 30);
    assert.equal(snapshot.namespacesQueried, 1);
    assert.equal(snapshot.commandsQueried, 1);
    assert.equal((await statistics.snapshot('first')).calls, 15);
    assert.equal((await statistics.snapshot('second')).commandsQueried, 0);
    assert.equal((await statistics.snapshot('missing')).calls, 0);
    snapshot.callsByTool.read = 100;
    await statistics.flush();
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).callsByTool.read, 30);
    assert.deepEqual(await restored.snapshot('first'), await statistics.snapshot('first'));
});

test('query targets count normalized occurrences without expanding members or runtime APIs', async () => {
    const root = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]);
    assert.deepEqual(inspectQueryTargets(['', 'global.std.', 'std', 'std.read', 'global.std.read', 'std.read.', 'missing', 'console.', 'console.log'], root), [
        { path: '', namespace: true }, { path: 'std', namespace: true }, { path: 'std', namespace: true },
        { path: 'std.read', namespace: false, tool: 'read' }, { path: 'std.read', namespace: false, tool: 'read' },
    ]);
    assert.throws(() => inspectQueryTargets(['std..'], root), /Invalid Inspect query/);
});

test('dispatch counts physical tools once for both entry and direct dispatch, including failures', async () => {
    const statistics = new CommandStatistics(new MemoryStore());
    const component = Object.assign(Object.create(NamespaceComponent.prototype) as NamespaceComponent, { statistics });
    const events: string[] = [];
    let fail = false;
    const agent = { id: 'session', session: { append: (event: string) => events.push(event) }, ctx: { tools: {
        execute: async () => fail ? { isError: true, error: { message: 'denied' }, content: [] } : { isError: false, value: 'ok', content: [] },
    } } } as unknown as Agent;
    const parent = { callId: 'parent', rootCallId: 'root', deferContext: () => {} } as unknown as ToolRunContext;
    const entry = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]).commands().find(node => node.path === 'std.read')!;
    assert.equal(await component.dispatch(agent, entry, {}, parent, 1), 'ok');
    fail = true;
    await assert.rejects(component.dispatchTool(agent, 'read', {}, parent, 2), /denied/);
    assert.equal((await statistics.snapshot('session')).callsByTool.read, 2);
    assert.equal((await statistics.snapshot()).calls, 2);
    assert.deepEqual(events, ['tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch']);
});

for (const ptc of [false, true]) test(`physical Inspect records query targets internally in ${ptc ? 'PTC' : 'native'} mode`, async () => {
    const statistics = new CommandStatistics(new MemoryStore());
    const root = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]);
    const namespaces = {
        statistics, registryFor: async () => ({ effective: () => [], description: () => undefined, disabled: () => false, snapshot: () => ({ revision: 0 }) }),
        tree: async () => root, isPtc: () => ptc, discover: async () => '{}', position: () => ({ turn: 0, step: 0 }),
    } as unknown as NamespaceComponent;
    let definition!: ToolDefinition;
    const ctx = { effect: (callback: () => unknown) => callback(), tools: {
        register: (value: ToolDefinition) => { definition = value; return () => {}; },
    } } as unknown as Context;
    registerInspect(ctx, namespaces);
    const execution = {
        callId: 'query', signal: new AbortController().signal,
        agent: { id: 'session', session: Session.create(SessionId('statistics-query')), ctx: { get: (key: string) => key === 'commandNamespaces' ? namespaces : undefined } },
    } as unknown as ToolRunContext;
    await definition.execute({ queries: ['global.std.', 'std.read', 'console.log'] }, execution);
    const counts = await statistics.snapshot('session');
    assert.equal(counts.calls, 0);
    assert.deepEqual(counts.namespaceQueriesByPath, { std: 1 });
    assert.deepEqual(counts.commandQueriesByPath, { 'std.read': 1 });
});


test('global tool query totals follow physical identities across aliases and survive reload', async () => {
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    const root = namespace([
        { path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} },
        { path: 'files.read', tool: 'read', doc: '', schema: {}, output: {} },
    ]);
    await Promise.all([
        statistics.recordQueries('first', inspectQueryTargets(['std.', 'std.read', 'global.std.read'], root)),
        statistics.recordQueries('second', inspectQueryTargets(['files.', 'files.read'], root)),
    ]);
    const snapshot = await statistics.snapshot();
    assert.deepEqual(snapshot.queriesByTool, { read: 3 });
    assert.deepEqual(snapshot.namespaceQueriesByPath, { std: 1, files: 1 });
    assert.deepEqual((await statistics.snapshot('first')).queriesByTool, {});
    snapshot.queriesByTool.read = 100;
    await statistics.flush();
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.deepEqual((await restored.snapshot()).queriesByTool, { read: 3 });
});

test('failed persistence retains live deltas and retries the same journal before new increments', async () => {
    /** @brief Reject the journal write until storage becomes available again. */
    class FailingStore extends MemoryStore {
        fail = false;
        override async save<T>(key: string, value: T): Promise<void> {
            if (this.fail) throw new Error('injected write failure');
            await super.save(key, value);
        }
    }
    const store = new FailingStore();
    const statistics = new CommandStatistics(store);
    await statistics.recordCall('existing', 'read');
    await statistics.flush();
    store.fail = true;
    await statistics.recordQueries('new', [{ path: 'std.read', namespace: false, tool: 'read' }]);
    await assert.rejects(statistics.flush(), /injected/);
    assert.equal((await statistics.snapshot()).commandsQueried, 1);
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).commandsQueried, 0);
    await Promise.all(Array.from({ length: 30 }, () => statistics.recordCall('existing', 'read')));
    store.fail = false;
    await statistics.flush();
    await restored.load();
    assert.deepEqual(await restored.snapshot(), await statistics.snapshot());
    assert.equal((await restored.snapshot()).calls, 31);
    await statistics.dispose();
});

test('updates during IO remain visible and form the next dirty batch without blocking dispatch', async () => {
    let started!: () => void;
    let finish!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    /** @brief Hold one journal write while allowing new memory increments. */
    class DelayedStore extends MemoryStore {
        writes = 0;
        override async save<T>(key: string, value: T): Promise<void> {
            if (++this.writes === 1) { started(); await gate; }
            await super.save(key, value);
        }
    }
    const store = new DelayedStore();
    const statistics = new CommandStatistics(store);
    await statistics.recordCall('first', 'read');
    const first = statistics.flush();
    await writing;
    await statistics.recordCall('second', 'read');
    await statistics.recordQueries('first', [{ path: 'std.read', namespace: false, tool: 'read' }]);
    assert.equal((await statistics.snapshot()).calls, 2);
    assert.equal((await statistics.snapshot()).queriesByTool.read, 1);
    finish();
    await first;
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).calls, 1);
    await statistics.flush();
    await restored.load();
    assert.deepEqual(await restored.snapshot(), await statistics.snapshot());
    await statistics.dispose();
});

test('statistics recover only invalid portions of older snapshots and stamp the current version', async () => {
    const { storageVersion } = await import('../../src/storage/version.js');
    for (const version of [undefined, 1, storageVersion + 1]) {
        const store = new MemoryStore();
        await store.save('command_statistics', { version, sessions: [
            ['good', { callsByTool: { read: 3, broken: -1 }, namespaceQueriesByPath: null, commandQueriesByPath: { 'std.read': 2 } }],
            ['bad', null], null,
        ], queriesByTool: { read: 2, bad: 'broken' } });
        const statistics = new CommandStatistics(store);
        await statistics.load();
        assert.equal((await statistics.snapshot()).calls, 3);
        assert.equal((await statistics.snapshot()).commandsQueried, 2);
        assert.deepEqual((await statistics.snapshot()).queriesByTool, { read: 2 });
        assert.equal((await store.load<{ version: number }>('command_statistics'))?.version, storageVersion);
        await new CommandStatistics(store).load();
    }
    const store = new MemoryStore();
    await store.save('command_statistics', { sessions: { old: {} }, queriesByTool: { read: 4 } });
    const statistics = new CommandStatistics(store);
    await statistics.load();
    assert.equal((await statistics.snapshot()).calls, 0);
    assert.deepEqual((await statistics.snapshot()).queriesByTool, { read: 4 });
});

test('current statistics stay strict until explicit recovery and failed recovery writes preserve memory', async () => {
    const { storageVersion } = await import('../../src/storage/version.js');
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    await statistics.recordCall('good', 'read');
    await statistics.flush();
    const before = await statistics.snapshot();
    await store.save('command_statistics', { version: storageVersion, sessions: {}, queriesByTool: { read: 4, bad: -1 } });
    await assert.rejects(statistics.load());
    assert.deepEqual(await statistics.snapshot(), before);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('Disk failed'); };
    await assert.rejects(statistics.load(true), /Disk failed/);
    assert.deepEqual(await statistics.snapshot(), before);
    store.save = save;
    await statistics.load(true);
    assert.equal((await statistics.snapshot()).calls, 0);
    assert.deepEqual((await statistics.snapshot()).queriesByTool, { read: 4 });
});

test('dirty timers merge updates over thirty seconds, preserve their deadline, and stop writing when clean', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    const writes: string[] = [];
    const save = store.save.bind(store);
    store.save = async (key, value) => { writes.push(key); await save(key, value); };
    await statistics.recordCall('first', 'read');
    t.mock.timers.tick(15_000);
    await statistics.recordCall('first', 'read');
    assert.equal(writes.length, 0);
    assert.equal((await statistics.snapshot()).calls, 2);
    t.mock.timers.tick(15_000);
    // The expired timer's write precedes this explicitly queued drain.
    await statistics.flush();
    assert.equal(writes.filter(key => key === 'command_statistics_journal').length, 1);
    assert.equal(writes.length, 3);
    assert.equal((await store.loadEntries('command_statistics')).length, 2);
    t.mock.timers.tick(60_000);
    await statistics.flush();
    assert.equal(writes.length, 3);
    await statistics.dispose();
    await assert.rejects(statistics.recordCall('first', 'read'), /disposed/);
});

test('persistence modifies only dirty session checkpoints and the global checkpoint', async () => {
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    await statistics.recordCall('untouched', 'read');
    await statistics.flush();
    const initial = await store.loadEntries('command_statistics_session_');
    const untouchedKey = initial[0]![0];
    const writes: Array<[string, unknown]> = [];
    const save = store.save.bind(store);
    store.save = async (key, value) => { writes.push([key, structuredClone(value)]); await save(key, value); };
    await Promise.all(Array.from({ length: 50 }, () => statistics.recordCall('target', '__proto__')));
    await statistics.recordQueries('target', [{ path: '', namespace: true }, { path: 'alias.read', namespace: false, tool: '__proto__' }]);
    assert.equal(writes.length, 0);
    await statistics.flush();
    assert.equal(writes.length, 3);
    assert(!writes.some(([key]) => key === untouchedKey));
    assert.deepEqual(await store.load(untouchedKey), initial[0]![1]);
    const journal = writes[0]![1] as { writes: Array<[string, { session?: string; counts: { callsByTool: Record<string, number> } }]> };
    assert.equal(journal.writes.length, 2);
    assert.equal(journal.writes[0]![1].session, 'target');
    assert.equal(journal.writes[0]![1].counts.callsByTool.__proto__, 50);
    assert.equal((await statistics.snapshot()).calls, 51);
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.deepEqual(await restored.snapshot(), await statistics.snapshot());
    assert.deepEqual(await restored.snapshot('target'), await statistics.snapshot('target'));
});

test('automatic persistence failure reports the error and schedules a dirty retry', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new MemoryStore();
    const save = store.save.bind(store);
    let fail = true;
    let report!: () => void;
    const reported = new Promise<void>(resolve => { report = resolve; });
    const errors: unknown[] = [];
    const statistics = new CommandStatistics(store, { flushDelayMs: 100, onError: error => { errors.push(error); report(); } });
    store.save = async (key, value) => { if (fail) throw new Error('temporarily unavailable'); await save(key, value); };
    await statistics.recordCall('first', 'read');
    t.mock.timers.tick(100);
    await reported;
    assert.equal(errors.length, 1);
    assert.equal((await statistics.snapshot()).calls, 1);
    fail = false;
    t.mock.timers.tick(100);
    await statistics.flush();
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).calls, 1);
    await statistics.dispose();
});

test('dispose flushes dirty data and cancels its scheduled timer', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new MemoryStore();
    const statistics = new CommandStatistics(store);
    await statistics.recordCall('last', 'read');
    await statistics.dispose();
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).calls, 1);
    const save = store.save.bind(store);
    store.save = async () => { throw new Error('disposed timer must not run'); };
    t.mock.timers.tick(60_000);
    await statistics.dispose();
    store.save = save;
});

test('counter overflow rejects an entire increment without partially publishing it', async () => {
    const { storageVersion } = await import('../../src/storage/version.js');
    const store = new MemoryStore();
    await store.save('command_statistics', { version: storageVersion, sequence: 0,
        counts: { callsByTool: {}, namespaceQueriesByPath: {}, commandQueriesByPath: {} }, queriesByTool: { read: Number.MAX_SAFE_INTEGER } });
    const statistics = new CommandStatistics(store);
    await statistics.load();
    const before = await statistics.snapshot();
    await assert.rejects(statistics.recordQueries('new', [{ path: 'files.read', namespace: false, tool: 'read' }]));
    assert.deepEqual(await statistics.snapshot(), before);
    assert.equal((await statistics.snapshot('new')).commandsQueried, 0);
    await statistics.dispose();
});
