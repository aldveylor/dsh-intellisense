import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import * as presentation from '../../src/integration/presentation.js';
import { NamespaceComponent } from '../../src/integration/namespace_component.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';
import { RuntimeConfig } from '../../src/runtime/host.js';
import { ptcToolName } from '../../src/runtime/builtins.js';
import { executionInstructions } from '../../src/integration/prompt.js';

/** @brief Mount the real scoped presentation beside a deployment-default runtime that must never execute namespace code. */
async function fixture() {
    const ctx = new Context();
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 1 });
    await ctx.plugin(ToolRuntime, { mode: 'ptc' });
    const defaultRuntime = { language: 'typescript', run: () => { throw new Error('Default runtime selected'); } };
    ctx.provide('ptcRuntime', defaultRuntime as unknown as Context['ptcRuntime']);
    const agents: Agent[] = [];
    ctx.provide('agents', { list: () => agents } as unknown as Context['agents']);
    ctx.provide('codeRuntimeOptions', RuntimeConfig.parse({ timeoutMs: 3000 }));
    const store = new MemoryStore();
    const catalog = new SemanticRegistry(store);
    const namespaces = new NamespaceComponent(ctx, catalog, new ProfileSessions(catalog, store), []);
    ctx.provide('commandNamespaces', namespaces);
    let toolContext = ctx;
    await ctx.plugin({ inject: ['tools'], apply: (scope: Context) => { toolContext = scope; } });
    const key = {};
    const standing = createScope(toolContext, key);
    const mounted = await standing.ctx.plugin(presentation, { mode: 'ptc' });
    const agent = { id: 'ptc-runtime', session: Session.create(SessionId('ptc-runtime')) } as Agent;
    const live = createScope(toolContext, agent, { parent: key });
    Object.assign(agent, { ctx: live.ctx });
    agents.push(agent);
    let sequence = 0;
    const run = (code: string, timeoutMs?: number, signal = new AbortController().signal) => ctx.tools.execute({
        agent, callId: ToolCallId(`parent-${++sequence}`), name: ptcToolName,
        arguments: { code, description: 'Test namespace execution', ...(timeoutMs === undefined ? {} : { timeoutMs }) }, signal,
    });
    const dispose = async () => { await live.dispose(); await mounted.dispose(); await standing.dispose(); await ctx.fiber.dispose(); };
    return { ctx, agent, namespaces, run, dispose, standing, mounted, defaultRuntime };
}

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
        await registry.configure([{ id: 'wait_tool', path: 'std.wait', aliases: [], enabled: true, pinned: false }], registry.snapshot().revision);
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
        await registry.configure([{ id: 'read_tool', path: 'std.read', aliases: [], enabled: true, pinned: false }], registry.snapshot().revision);
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
