import { Statistics } from '../../src/statistics/statistics.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { MemoryStore } from '../../src/storage/store.js';
import { CommandStatistics } from '../../src/statistics/command_statistics.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { inspectQueryTargets, registerInspect } from '../../src/tools/inspect.js';
import { namespace } from '../namespace/fixtures.js';

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
    const component = Object.assign(Object.create(NamespaceIntegration.prototype) as NamespaceIntegration, { statistics, profiles: { addition: async (session: { id: string }) => ({ statistics: statistics.calls.scope(session.id) }) } });
    const events: string[] = [];
    let fail = false;
    const agent = { id: 'session', session: { id: 'session', append: (event: string) => events.push(event) }, ctx: { tools: {
        execute: async () => fail ? { isError: true, error: { message: 'denied' }, content: [] } : { isError: false, value: 'ok', content: [] },
    } } } as unknown as Agent;
    const parent = { callId: 'parent', rootCallId: 'root', deferContext: () => {} } as unknown as ToolRunContext;
    const entry = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]).commands().find(node => node.path === 'std.read')!;
    assert.equal(await component.dispatch(agent, entry, {}, parent, 1), 'ok');
    fail = true;
    await assert.rejects(component.dispatchTool(agent, 'read', {}, parent, 2), /denied/);
    assert.equal((await statistics.calls.snapshot('session')).read, 2);
    assert.equal((await statistics.calls.snapshot()).read, 2);
    assert.deepEqual(events, ['tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch']);
});

for (const ptc of [false, true]) test(`physical Inspect records query targets internally in ${ptc ? 'PTC' : 'native'} mode`, async () => {
    const statistics = new CommandStatistics(new MemoryStore());
    const root = namespace([{ path: 'std.read', tool: 'read', doc: '', schema: {}, output: {} }]);
    let selected = 'Default';
    const namespaces = {
        statistics, inspectStatistics: new Statistics(new MemoryStore(), 'inspect_statistics'), registryFor: async () => ({ profileSelection: () => ({ selected }), effective: () => [], description: () => undefined, disabled: () => false, revision: 0, snapshot: () => ({ revision: 0 }) }),
        tree: async () => root, isPtc: () => ptc, discover: async () => '{}', position: () => ({ turn: 0, step: 0 }),
    } as unknown as NamespaceIntegration;
    let definition!: ToolDefinition;
    const ctx = { effect: (callback: () => unknown) => callback(), tools: {
        register: (value: ToolDefinition) => { definition = value; return () => {}; },
    } } as unknown as Context;
    registerInspect(ctx, namespaces);
    const execution = {
        callId: 'query', signal: new AbortController().signal,
        agent: { id: 'session', session: Session.create(SessionId('statistics-query')), ctx: { get: (key: string) => key === 'namespaceIntegration' ? namespaces : undefined } },
    } as unknown as ToolRunContext;
    await definition.execute({ queries: ['global.std.', 'std.read', 'console.log'] }, execution);
    assert.deepEqual(await namespaces.inspectStatistics.snapshot('Default'), { std: 1, 'std.read': 1 });
    assert.deepEqual(await statistics.calls.snapshot(), {});
    assert.deepEqual(await statistics.queries.snapshot(), { read: 1 });
    selected = 'Other';
    await definition.execute({ queries: ['std.read', 'std.read'] }, execution);
    selected = 'Default';
    const otherSession = { ...execution, agent: { ...execution.agent!, id: 'second' } } as ToolRunContext;
    await definition.execute({ queries: ['std.read'] }, otherSession);
    assert.deepEqual(await namespaces.inspectStatistics.snapshot('Default'), { std: 1, 'std.read': 2 });
    assert.deepEqual(await namespaces.inspectStatistics.snapshot('Other'), { 'std.read': 2 });
    assert.deepEqual(await statistics.queries.snapshot(), { read: 4 });
});
