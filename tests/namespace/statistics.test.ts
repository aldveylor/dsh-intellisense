import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { MemoryStore } from '../../src/storage/store.js';
import { CommandStatistics } from '../../src/namespace/statistics.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { intellisenseQueryTargets, registerIntellisense } from '../../src/tools/intellisense.js';
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
    const restored = new CommandStatistics(store);
    await restored.load();
    assert.equal((await restored.snapshot()).callsByTool.read, 30);
    assert.deepEqual(await restored.snapshot('first'), await statistics.snapshot('first'));
});

test('query targets count normalized occurrences without expanding members or runtime APIs', async () => {
    const root = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]);
    assert.deepEqual(intellisenseQueryTargets(['', 'global.std.', 'std', 'std.read', 'global.std.read', 'std.read.', 'missing', 'console.', 'console.log'], root), [
        { path: '', namespace: true }, { path: 'std', namespace: true }, { path: 'std', namespace: true },
        { path: 'std.read', namespace: false }, { path: 'std.read', namespace: false },
    ]);
    assert.throws(() => intellisenseQueryTargets(['std..'], root), /Invalid IntelliSense query/);
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

for (const ptc of [false, true]) test(`physical IntelliSense records query targets internally in ${ptc ? 'PTC' : 'native'} mode`, async () => {
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
    registerIntellisense(ctx, namespaces);
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
