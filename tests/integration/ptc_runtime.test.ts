import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import * as presentation from '../../src/integration/presentation.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';
import { RuntimeConfig } from '../../src/runtime/host.js';
import { ptcToolName } from '../../src/runtime/builtins.js';
import { executionInstructions } from '../../src/namespace/prompt.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import { DshStore, type Store } from '../../src/storage/store.js';
import { CommandStatistics } from '../../src/namespace/statistics.js';
import { createSearchEngines } from '../../src/search/search.js';

/** @brief Mount a scoped presentation beside a deployment-default runtime that must never execute namespace code. */
async function fixture(store: Store = new MemoryStore(), mode: 'ptc' | 'native' = 'ptc') {
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 1 });
    await ctx.plugin(ToolRuntime, { mode: 'ptc' });
    const defaultRuntime = { language: 'typescript', run: () => { throw new Error('Default runtime selected'); } };
    ctx.provide('ptcRuntime', defaultRuntime as unknown as Context['ptcRuntime']);
    const agents: Agent[] = [];
    ctx.provide('agents', { list: () => agents } as unknown as Context['agents']);
    ctx.provide('codeRuntimeOptions', RuntimeConfig.parse({ timeoutMs: 3000 }));
    const catalog = new SemanticRegistry(store);
    const statistics = new CommandStatistics(store);
    await statistics.load();
    const namespaces = new NamespaceComponent(ctx, catalog, new ProfileSessions(catalog, store), [], createSearchEngines(), statistics);
    ctx.provide('commandNamespaces', namespaces);
    let toolContext = ctx;
    await ctx.plugin({ inject: ['tools'], apply: (scope: Context) => { toolContext = scope; } });
    const key = {};
    const standing = createScope(toolContext, key);
    const mounted = await standing.ctx.plugin(presentation, { mode });
    const injected: UserMessage[] = [];
    const agent = { inject: (message: UserMessage) => { injected.push(message); }, id: 'ptc-runtime', session: Session.create(SessionId('ptc-runtime')) } as Agent;
    const live = createScope(toolContext, agent, { parent: key });
    Object.assign(agent, { ctx: live.ctx });
    agents.push(agent);
    let sequence = 0;
    const run = (code: string, timeoutMs?: number, signal = new AbortController().signal) => ctx.tools.execute({
        agent, callId: ToolCallId(`parent-${++sequence}`), name: ptcToolName,
        arguments: { code, description: 'Test namespace execution', ...(timeoutMs === undefined ? {} : { timeoutMs }) }, signal,
    });
    const dispose = async () => { await live.dispose(); await mounted.dispose(); await standing.dispose(); await ctx.fiber.dispose(); };
    return { ctx, agent, namespaces, run, dispose, standing, mounted, defaultRuntime, injected };
}

test('PTC worker dispatches and discovery persist session and global statistics through the JSON backend', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intellisense-ptc-statistics-'));
    const descriptor = { name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' as const };
    let backend = new JsonStorageBackend(directory);
    try {
        const unit = await backend.kv.open(descriptor);
        const { ctx, agent, namespaces, run, dispose } = await fixture(new DshStore(unit));
        let expected;
        try {
            agent.ctx.tools.register(defineTool({ name: 'read_tool', description: 'Read', parameters: {},
                output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'ok',
            }));
            agent.ctx.tools.register(defineTool({ name: 'fail_tool', description: 'Fail', parameters: {},
                output: { schema: { type: 'string' }, render: () => [] }, execute: async () => { throw new Error('Expected failure'); },
            }));
            const registry = await namespaces.registryFor(agent);
            await registry.configure([
                { id: 'read_tool', path: 'std.read', aliases: [], pinned: false },
                { id: 'fail_tool', path: 'std.fail', aliases: [], pinned: false },
            ], registry.snapshot().revision);
            const result = await run('console.log("excluded"); const commands = tools.profile.commands; await tools.intellisense("global.std.", "std.read", "console.log"); return await Promise.all([std.read(), std.read()]);');
            assert.equal(result.isError, false, JSON.stringify(result));
            assert.deepEqual(result.value, { logs: ['excluded'], result: ['ok', 'ok'] });
            const failed = await run('return await std.fail();');
            assert.equal(failed.isError, true);
            const unguard = ctx.tools.guard(execution => execution.name === 'read_tool' ? 'Denied for statistics test' : undefined);
            try {
                const denied = await run('return await std.read();');
                assert.equal(denied.isError, true);
                assert.match(JSON.stringify(denied), /Denied for statistics test/);
            } finally { unguard(); }
            expected = await namespaces.statistics.snapshot();
            assert.equal(expected.calls, 5);
            assert.deepEqual(expected.callsByTool, { tools_intellisense: 1, read_tool: 3, fail_tool: 1 });
            assert.deepEqual(expected.namespaceQueriesByPath, { std: 1 });
            assert.deepEqual(expected.commandQueriesByPath, { 'std.read': 1 });
            assert.deepEqual(await namespaces.statistics.snapshot(agent.id), expected);
            assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch-start').length, expected.calls);
            await namespaces.release(agent.id);
        } finally { await dispose(); }
        await backend.close();
        backend = new JsonStorageBackend(directory);
        const restored = new CommandStatistics(new DshStore(await backend.kv.open(descriptor)));
        await restored.load();
        assert.deepEqual(await restored.snapshot(), expected);
        assert.deepEqual(await restored.snapshot(agent.id), expected);
    } finally {
        await backend.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('PTC command counts update within a program and refresh from host counts on the next execution', async () => {
    const { agent, namespaces, run, dispose } = await fixture();
    try {
        agent.ctx.tools.register(defineTool({ name: 'read_tool', description: 'Read', parameters: {},
            output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'ok',
        }));
        const registry = await namespaces.registryFor(agent);
        await registry.configure([{ id: 'read_tool', path: 'std.read', aliases: ['std.again'], pinned: false }], registry.snapshot().revision);
        const result = await run(`
            const row=tools.profile.commands.find(row=>row.name==='read_tool');
            const before=row.totalCalls;
            const first=std.read();
            const immediate=row.totalCalls;
            await first;
            await std.again();
            return [before,immediate,row.totalCalls];
        `);
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.deepEqual(result.value, { logs: [], result: [0, 1, 2] });
        assert.equal((await namespaces.statistics.snapshot()).callsByTool.read_tool, 2);
        const next = await run(`
            const row=tools.profile.commands.find(row=>row.name==='read_tool');
            const before=row.totalCalls;
            await std.read();
            return [before,row.totalCalls];
        `);
        assert.equal(next.isError, false, JSON.stringify(next));
        assert.deepEqual(next.value, { logs: [], result: [2, 3] });
        assert.equal((await namespaces.statistics.snapshot()).callsByTool.read_tool, 3);
    } finally { await dispose(); }
});

test('native commands rereads current global counts after each namespace dispatch', async () => {
    const { ctx, agent, namespaces, dispose } = await fixture(new MemoryStore(), 'native');
    try {
        agent.ctx.tools.register(defineTool({ name: 'read_tool', description: 'Read', parameters: {},
            output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'ok',
        }));
        const registry = await namespaces.registryFor(agent);
        await registry.configure([{ id: 'read_tool', path: 'std.read', aliases: [], pinned: false }], registry.snapshot().revision);
        await namespaces.discover(agent, ['std.read', 'tools.profile.commands']);
        let sequence = 0;
        const call = (name: string) => ctx.tools.execute({ agent, callId: ToolCallId(`native-statistics-${++sequence}`), name, arguments: {}, signal: new AbortController().signal });
        const before = await call('ns_tools__profile__commands');
        assert.equal(before.isError, false, JSON.stringify(before));
        assert.equal((await call('ns_std__read')).isError, false);
        const after = await call('ns_tools__profile__commands');
        assert.equal(after.isError, false, JSON.stringify(after));
        const count = (value: unknown): number | undefined => (value as { name: string; totalCalls: number }[]).find(row => row.name === 'read_tool')?.totalCalls;
        assert.equal(count(before.value), 0);
        assert.equal(count(after.value), 1);
        const unguard = ctx.tools.guard(execution => execution.name === 'read_tool' ? 'Denied' : undefined);
        try { assert.equal((await call('ns_std__read')).isError, true); }
        finally { unguard(); }
        const latest = await call('ns_tools__profile__commands');
        assert.equal(latest.isError, false, JSON.stringify(latest));
        assert.equal(count(latest.value), 2);
        assert.equal((await namespaces.statistics.snapshot(agent.id)).callsByTool.read_tool, 2);
    } finally { await dispose(); }
});

test('PTC discovery uses namespace execution instead of the deployment Node runtime', async () => {
    const { ctx, agent, namespaces, run, dispose, mounted, defaultRuntime } = await fixture();
    try {
        assert.equal(ctx.tools.get('run_code', agent), undefined);
        assert(ctx.tools.get(ptcToolName, agent));
        assert(!ctx.tools.get(ptcToolName));
        assert(ctx.tools.get('run_code'));
        const secondKey = {};
        const second = createScope(ctx, secondKey);
        try {
            const other = await second.ctx.plugin(presentation, { mode: 'ptc' });
            assert(ctx.tools.get(ptcToolName, secondKey));
            await other.dispose();
            assert(!ctx.tools.get(ptcToolName, secondKey));
            assert(ctx.tools.get(ptcToolName, agent));
        } finally { await second.dispose(); }
        assert.equal(ctx.get('ptcRuntime')!.run, defaultRuntime.run);
        assert(!namespaces.physical(agent).some(tool => tool.id === ptcToolName));
        assert(executionInstructions('ptc').includes(`Call ${ptcToolName} with code`));
        const result = await run('const r = await tools.intellisense("", "std.", "tools.", "tools.intellisense"); return r;');
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.match((result.value as { result: string }).result, /namespace tools/);
        assert.match((result.value as { result: string }).result, /function intellisense\(\.\.\.args: string\[\]\)/);
        const events = agent.session.snapshotEvents();
        assert(events.some(event => String(event.type) === 'plugin:ts_intellisense/intellisense'));
        const child = events.find(event => event.type === 'tool/ptc-dispatch-start');
        assert(child && child.data.name === 'tools_intellisense');
        assert.equal(child.data.parentCallId, 'parent-1');
        const denied = ctx.tools.guard(exec => exec.name === 'tools_intellisense' ? 'Denied by native guard' : undefined);
        try {
            const failure = await run('return await tools.intellisense("tools.");');
            assert.equal(failure.isError, true);
            assert.match(JSON.stringify(failure), /Denied by native guard/);
        } finally { denied(); }
        await mounted.dispose();
        assert(!ctx.tools.get(ptcToolName, agent));
        assert.equal(namespaces.enabled(agent), false);
    } finally { await dispose(); }
});

test('PTC discovery accepts zero, single, variadic and spread queries through the real worker', async () => {
    const { agent, namespaces, run, dispose } = await fixture();
    try {
        const prompt = await namespaces.prompt(agent);
        assert.match(prompt, /function intellisense\(\.\.\.args: string\[\]\): Promise<string>/);
        const cases = [
            { code: 'return await tools.intellisense();', queries: [] },
            { code: 'return await tools.intellisense("");', queries: [''] },
            { code: 'return await tools.intellisense("tools.intellisense");', queries: ['tools.intellisense'] },
            { code: 'return await tools.intellisense("", "tools.intellisense", "tools.profile.");', queries: ['', 'tools.intellisense', 'tools.profile.'] },
            { code: 'const queries = ["", "tools.intellisense"]; return await tools.intellisense(...queries);', queries: ['', 'tools.intellisense'] },
        ];
        for (const { code, queries } of cases) {
            const result = await run(code);
            assert.equal(result.isError, false, JSON.stringify(result));
            assert.equal(typeof (result.value as { result: unknown }).result, 'string');
            if (queries.includes('')) assert.match((result.value as { result: string }).result, /namespace tools/);
            if (queries.includes('tools.intellisense')) assert.match((result.value as { result: string }).result, /function intellisense\(\.\.\.args: string\[\]\)/);
            const child = [...agent.session.snapshotEvents()].reverse().find(event => event.type === 'tool/ptc-dispatch-start');
            assert(child?.type === 'tool/ptc-dispatch-start');
            assert.deepEqual(child.data.arguments, { queries });
        }
        const array = await run('return await tools.intellisense(["tools."]);');
        assert.equal(array.isError, true);
        assert.match(JSON.stringify(array), /Invalid arguments/i);
    } finally { await dispose(); }
});

test('PTC cancellation drains native children and timeout permits the next execution', { timeout: 10_000 }, async () => {
    const { ctx, agent, namespaces, run, dispose } = await fixture();
    try {
        let started: () => void = () => {};
        const ready = new Promise<void>(resolve => { started = resolve; });
        let settled = false;
        agent.ctx.tools.register(defineTool({ name: 'wait_tool', description: 'Wait for cancellation', parameters: {},
            output: { schema: { type: 'null' }, render: () => [] },
            execute: async (_args, execution) => {
                started();
                try {
                    await new Promise<void>((_resolve, reject) => {
                        if (execution.signal.aborted) reject(execution.signal.reason);
                        else execution.signal.addEventListener('abort', () => { reject(execution.signal.reason); }, { once: true });
                    });
                    return null;
                } finally { settled = true; }
            },
        }));
        const registry = await namespaces.registryFor(agent);
        await registry.configure([{ id: 'wait_tool', path: 'std.wait', aliases: [], pinned: false }], registry.snapshot().revision);
        const controller = new AbortController();
        const work = run('return await std.wait();', undefined, controller.signal);
        await ready;
        controller.abort(new Error('Cancelled by caller'));
        const cancelled = await work;
        assert.equal(cancelled.isError, true);
        assert.equal(settled, true);
        const timedOut = await run('return await std.wait();', 100);
        assert.equal(timedOut.isError, true);
        assert.match(JSON.stringify(timedOut), /timeout/);
        const next = await run('return 42;');
        assert.equal(next.isError, false, JSON.stringify(next));
        assert.deepEqual(next.value, { logs: [], result: 42 });
        assert(ctx.tools.get(ptcToolName, agent));
    } finally { await dispose(); }
});

test('PTC projects results once, preserves void results and supports parallel native children', async () => {
    const { agent, namespaces, run, dispose } = await fixture();
    try {
        agent.ctx.tools.register(defineTool({ name: 'read_tool', description: 'Read nested result', parameters: { path: { type: 'string', required: true } },
            output: { schema: { type: 'object', properties: { value: { type: 'object', properties: { value: { type: 'string', required: true } }, additionalProperties: false, required: true } }, additionalProperties: false }, render: () => [] },
            execute: async ({ path }) => ({ value: { value: path } }),
        }));
        const registry = await namespaces.registryFor(agent);
        await registry.configure([{ id: 'read_tool', path: 'std.read', aliases: [], pinned: false }], registry.snapshot().revision);
        const result = await run('return await Promise.all([std.read("a"), std.read("b")]);');
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.deepEqual(result.value, { logs: [], result: [{ value: 'a' }, { value: 'b' }] });
        const children = agent.session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch-start');
        assert.equal(new Set(children.map(event => event.data.subCallId)).size, 2);
        const saved = await run('const profile = await tools.profile.load(); return typeof await tools.profile.save(profile);');
        assert.equal(saved.isError, false, JSON.stringify(saved));
        assert.deepEqual(saved.value, { logs: [], result: 'undefined' });
    } finally { await dispose(); }
});


test('PTC early returns and failed parallel calls drain native siblings without cancellation', async () => {
    const { agent, namespaces, run, dispose } = await fixture();
    try {
        let completed = 0;
        agent.ctx.tools.register(defineTool({ name: 'sibling_tool', description: 'Parallel sibling', parameters: { fail: { type: 'boolean', required: true } },
            output: { schema: { type: 'null' }, render: () => [] },
            execute: async ({ fail }, execution) => {
                if (fail) throw new Error('Expected sibling failure');
                await new Promise(resolve => setTimeout(resolve, 40));
                assert.equal(execution.signal.aborted, false);
                completed++;
                return null;
            },
        }));
        const registry = await namespaces.registryFor(agent);
        await registry.configure([{ id: 'sibling_tool', path: 'std.sibling', aliases: [], pinned: false }], registry.snapshot().revision);
        const early = await run('void std.sibling(false); return 42;');
        assert.equal(early.isError, false, JSON.stringify(early));
        assert.deepEqual(early.value, { logs: [], result: 42 });
        assert.equal(completed, 1);
        const failed = await run('return await Promise.all([std.sibling(true), std.sibling(false)]);');
        assert.equal(failed.isError, true);
        assert.match(JSON.stringify(failed), /Expected sibling failure/);
        assert.equal(completed, 2);
        const next = await run('return await std.sibling(false);');
        assert.equal(next.isError, false, JSON.stringify(next));
        assert.equal(completed, 3);
    } finally { await dispose(); }
});


test('PTC Profile save overloads preserve the selection and reject invalid calls', async () => {
    const { run, dispose } = await fixture();
    try {
        const saved = await run(`
            const profile = await tools.profile.load();
            await tools.profile.save('Copy', profile);
            profile.name = 'Ignored';
            await tools.profile.save(undefined, profile);
            await tools.profile.save(profile);
            return tools.profile.profiles;
        `);
        assert.equal(saved.isError, false, JSON.stringify(saved));
        assert.deepEqual(saved.value, { logs: [], result: { profiles: ['Copy', 'Default'], selected: 'Default' } });
        for (const args of ['', 'undefined', 'undefined, undefined', '42, profile', 'null, profile', 'profile, profile', 'profile, profile, profile']) {
            const rejected = await run(`
                const profile = await tools.profile.load();
                try { await tools.profile.save(${args}); return false; }
                catch { return true; }
            `);
            assert.equal(rejected.isError, false, JSON.stringify(rejected));
            assert.deepEqual(rejected.value, { logs: [], result: true }, args);
        }
        const loaded = await run("return (await tools.profile.load('Copy')).name;");
        assert.deepEqual(loaded.value, { logs: [], result: 'Copy' });
    } finally { await dispose(); }
});


test('PTC Profile deletion protects the selection and refreshes preloaded names', async () => {
    const { run, dispose } = await fixture();
    try {
        const result = await run(`
            const profile = await tools.profile.load();
            await tools.profile.save('Copy', profile);
            await tools.profile.switch('Copy');
            let blocked = false;
            try { await tools.profile.delete(); } catch { blocked = true; }
            const state = tools.profile.profiles;
            const returned = await tools.profile.delete('Default');
            return [blocked, typeof returned, state.profiles, state.selected];
        `);
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.deepEqual(result.value, { logs: [], result: [true, 'undefined', ['Copy'], 'Copy'] });
    } finally { await dispose(); }
});


test('PTC Profile switch changes the selection and rejects an omitted name', async () => {
    const { run, dispose } = await fixture();
    try {
        const result = await run(`
            const profile = await tools.profile.load();
            await tools.profile.save('Copy', profile);
            const state = tools.profile.profiles;
            const returned = await tools.profile.switch('Copy');
            let blocked = false;
            try { await tools.profile.switch(); } catch { blocked = true; }
            return [typeof returned, state.selected, blocked];
        `);
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.deepEqual(result.value, { logs: [], result: ['undefined', 'Copy', true] });
    } finally { await dispose(); }
});


test('Profile saves preserve the snapshot and inject notices only when explicitly loaded or switched', async () => {
    const { run, injected, namespaces, agent, dispose } = await fixture();
    try {
        const registry = await namespaces.registryFor(agent);
        const before = registry.snapshot();
        const saved = await run(`
            const profile = await tools.profile.load();
            await tools.profile.save('Copy', profile);
            await tools.profile.save(undefined, profile);
        `);
        assert.equal(saved.isError, false, JSON.stringify(saved));
        assert.deepEqual(registry.snapshot(), before);
        assert.deepEqual(injected, []);
        const result = await run(`
            const profile = await tools.profile.load();
            await tools.profile.switch('Default');
            await tools.profile.save(undefined, profile);
            await tools.profile.load('Copy');
            try { await tools.profile.switch('Missing'); } catch {}
            try { await tools.profile.save(); } catch {}
            try { await tools.profile.delete('Copy'); } catch {}
            await tools.profile.delete('Default');
        `);
        assert.equal(result.isError, false, JSON.stringify(result));
        assert.deepEqual(injected.map(message => message.content), ['Default', 'Copy'].map(name => [{ type: 'text', text: `Profile updated to ${name}` }]));
        assert(injected.every(message => message.source.kind === 'intellisense-profile'));
    } finally { await dispose(); }
});

test('native configuration refresh injects the Profile notice into the affected conversation', async () => {
    const { agent, namespaces, injected, dispose } = await fixture(new MemoryStore(), 'native');
    try {
        await namespaces.configurationChanged(agent);
        assert.deepEqual(injected.map(message => message.content), [[{ type: 'text', text: 'Profile updated to Default' }]]);
    } finally { await dispose(); }
});
