import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as plugin from '../../src/index.js';
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection';

/** @brief A real registered DSH model adapter supplies deterministic completed generations. */
class MockModel extends LlmAdapter {
    requests: GenerateOptions[] = [];
    responses = ['await std.fs.<|INTELLISENSE|>', 'read({path: "a"})', 'const count = 7; count', 'count + 1'];

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        const text = this.responses.shift() ?? '0';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

test('installed DSH agent loop, plugin, storage, completion, tools and web configuration work together', { timeout: 30_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-ts-'));
    const ctx = new Context(); const routes = new Map<string, ConnectionFetchRoute>();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] });
        await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        // Test only the application's handlers; production Connection owns authentication and owner checks.
        ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => { routes.set(route.path, route); return async () => { routes.delete(route.path); }; } } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused in this test'); } });
        const model = new MockModel(); ctx.llm.registerAdapter(['mock'], model);
        let invocations = 0;
        ctx.tools.register(defineTool({ name: 'read', description: 'Read a named file', parameters: { path: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { invocations++; return 'contents'; } }));
        await ctx.plugin(plugin, { provider: 'mock', model: 'test' });
        const stateRoute = routes.get('/api/ts-intellisense-state')!;
        assert(stateRoute);
        let state = await (await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state'))).json();
        assert.match(state.effective[0].path, /^unknown\./);
        const configured = await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'configure', revision: 0, mappings: [{ id: 'read', path: 'std.fs.read', aliases: [], enabled: true, authorized: true, pinned: false }] }) }));
        assert.equal(configured.status, 200, await configured.text());
        const agent = await ctx.agentLoop.create(SessionId('integration'), { provider: 'ts-repl', model: 'test' });
        const errors: unknown[] = []; ctx.on('agent/error', ({ error }) => { errors.push(error); });
        const send = async (text: string): Promise<void> => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle(); };
        await send('read the file');
        assert.equal(errors.length, 0, String(errors[0])); assert.equal(invocations, 1);
        assert.equal(model.requests.length, 2);
        assert.deepEqual(model.requests[0]!.tools, []);
        assert.equal(model.requests[1]!.messages.filter(m => m.role === 'user').length, 1);
        const messages = agent.session.deriveMessages();
        const assistant = messages.filter(m => m.role === 'assistant').at(-1)!;
        assert(assistant.content.some(b => b.type === 'text' && b.text.includes('contents') && !b.text.includes('<|INTELLISENSE|>')));
        await send('remember count'); await send('increment');
        assert.equal(errors.length, 0, String(errors[0]));
        assert(agent.session.deriveMessages().at(-1)!.content.some(b => b.type === 'text' && b.text.includes('// 8')));
        state = await (await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state'))).json();
        assert.equal(state.state.usage.read.calls, 1);
        // An independent native guard still denies an authorized semantic function.
        ctx.tools.guard(() => 'Native policy denial');
        model.responses.push('await std.fs.read({path: "b"})');
        await send('try denied tool');
        assert.equal(invocations, 1); assert(errors.length > 0);
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
