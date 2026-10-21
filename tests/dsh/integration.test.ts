import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent';
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
    afterReasoning?: () => Promise<void>;

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        const text = this.responses.shift() ?? '0';
        const reasoning = `Thinking about request ${this.requests.length}`;
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'reasoning-delta', index: 0, text: reasoning };
        await this.afterReasoning?.();
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } };
        yield { type: 'block-start', index: 1, blockType: 'text' };
        yield { type: 'text-delta', index: 1, text };
        yield { type: 'block-end', index: 1, block: { type: 'text', text } };
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
        ctx.tools.register(defineTool({ name: 'read', description: 'Read a named file', parameters: { path: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }], presentationMeta: () => ({ preview: 'contents' }) }, execute: async () => { invocations++; return 'contents'; } }));
        await ctx.plugin(plugin, { provider: 'mock', model: 'test' });
        const stateRoute = routes.get('/api/ts-intellisense-state')!;
        assert(stateRoute);
        let state = await (await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state'))).json();
        assert.match(state.effective[0].path, /^unknown\./);
        const configured = await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'configure', revision: 0, mappings: [{ id: 'read', path: 'std.fs.read', aliases: [], enabled: true, pinned: false }] }) }));
        assert.equal(configured.status, 200, await configured.text());
        const agent = await ctx.agentLoop.create(SessionId('integration'), { provider: 'ts-repl', model: 'test' });
        const events: SessionEvent[] = [];
        ctx.on('session/event', (session, event) => { if (session.id === agent.id) events.push(event); });
        let acknowledgeReasoning!: () => void;
        const reasoningDelivered = new Promise<void>(resolve => { acknowledgeReasoning = resolve; });
        model.afterReasoning = () => reasoningDelivered;
        const liveChunks: StreamChunk[] = [];
        ctx.on('agent/assistant-stream', ({ agent: current, frame }) => {
            if (current.id !== agent.id || frame.type !== 'chunk') return;
            liveChunks.push(frame.chunk);
            if (frame.chunk.type === 'reasoning-delta') acknowledgeReasoning();
        });
        let firstRequest: GenerateOptions | undefined;
        ctx.on('llm/stream', (request, next) => {
            if (!firstRequest && isAgentLoopRequest(request) && request.sessionId === agent.id) firstRequest = request;
            return next();
        }, { prepend: true });
        const errors: unknown[] = []; ctx.on('agent/error', ({ error }) => { errors.push(error); });
        const send = async (text: string): Promise<void> => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle(); };
        await send('read the file');
        assert.equal(errors.length, 0, String(errors[0])); assert.equal(invocations, 1);
        assert.equal(model.requests.length, 2);
        assert.deepEqual(model.requests[0]!.tools, []);
        assert.match(model.requests[0]!.system!, /<!> Promise/);
        assert.doesNotMatch(model.requests[0]!.system!, /whenAll|whenAny/);
        assert.equal(model.requests[1]!.messages.filter(m => m.role === 'user').length, 1);
        const messages = agent.session.deriveMessages();
        const assistant = messages.filter(m => m.role === 'assistant').at(-1)!;
        assert(assistant.content.some(b => b.type === 'text' && b.text.includes('contents') && !b.text.includes('<|INTELLISENSE|>')));
        assert.deepEqual(assistant.content.filter(b => b.type === 'reasoning').map(b => b.text), ['Thinking about request 1', 'Thinking about request 2']);
        assert.deepEqual(liveChunks.filter(c => c.type === 'reasoning-delta').map(c => c.index), [0, 1]);
        assert(liveChunks.some(c => c.type === 'text-delta' && c.index === 2 && c.text === 'contents'));
        assert(!liveChunks.some(c => c.type === 'tool-call-delta' || c.type === 'block-end' && c.block.type === 'tool-call'));
        const root = events.find(e => e.type === 'tool/call');
        const dispatchStart = events.find(e => e.type === 'tool/ptc-dispatch-start');
        const dispatchEnd = events.find(e => e.type === 'tool/ptc-dispatch');
        const rootResult = events.find(e => e.type === 'tool/result');
        assert(root?.type === 'tool/call' && rootResult?.type === 'tool/result');
        assert(dispatchStart?.type === 'tool/ptc-dispatch-start' && dispatchEnd?.type === 'tool/ptc-dispatch');
        assert.equal(root.data.name, 'ts_repl');
        assert.equal(dispatchStart.data.rootCallId, root.data.callId);
        assert.equal(dispatchStart.data.subCallId, dispatchEnd.data.subCallId);
        assert.equal(dispatchEnd.data.name, 'read');
        assert.deepEqual(dispatchEnd.data.arguments, { path: 'a' });
        assert.deepEqual(dispatchEnd.data.content, [{ type: 'text', text: 'contents' }]);
        assert.deepEqual(dispatchEnd.data.meta, { preview: 'contents' });
        assert.equal(dispatchEnd.data.isError, false);
        assert.equal(rootResult.data.message.source.callId, root.data.callId);
        assert.deepEqual(rootResult.sourceEventSeqs, [root.seq]);
        assert(root.seq < dispatchStart.seq && dispatchStart.seq < dispatchEnd.seq && dispatchEnd.seq < rootResult.seq);
        // Re-reading a completed logical request must not execute or log the tool again.
        assert(firstRequest);
        const eventCount = events.length;
        for await (const _chunk of ctx.llm.stream(firstRequest)) { /* Drain the cached response. */ }
        assert.equal(invocations, 1);
        assert.equal(events.length, eventCount);
        await send('remember count'); await send('increment');
        assert.equal(errors.length, 0, String(errors[0]));
        assert.match(model.requests.at(-1)!.system!, /<!> const count: 7/);
        assert.match(model.requests.at(-1)!.system!, /Frequently used namespaces \/ tool paths:\n<!> std\.fs\.read/);
        assert.match(model.requests.at(-1)!.system!, /Recently used namespaces \/ tool paths:\n<!> std\.fs\.read/);
        assert(agent.session.deriveMessages().at(-1)!.content.some(b => b.type === 'text' && b.text === '8'));
        state = await (await stateRoute.fetch(new Request('http://localhost/api/ts-intellisense-state'))).json();
        assert.equal(state.state.usage.read.calls, 1);
        // Reproduce session.v4.jsonl: a TS agent's UI selection routes directly to another provider.
        const selectedModel = new MockModel();
        selectedModel.responses = ['<|INTELLISENSE|>', 'count + 1'];
        ctx.llm.registerAdapter(['mock-account'], selectedModel);
        const selection = { assembled: undefined, current: { provider: 'mock-account', model: 'selected', reasoningEffort: undefined } };
        installModelSelection(agent.ctx, selection);
        let frozenRequest: GenerateOptions | undefined;
        ctx.on('llm/stream', (request, next) => {
            if (isAgentLoopRequest(request) && request.sessionId === agent.id) frozenRequest = request;
            return next();
        }, { prepend: true });
        await send('inspect current namespace after switching provider');
        assert.equal(errors.length, 0, String(errors[0]));
        assert.equal(selectedModel.requests.length, 2);
        assert.equal(selectedModel.requests[0]!.provider, 'mock-account');
        assert.equal(selectedModel.requests[0]!.model, 'selected');
        assert.deepEqual(selectedModel.requests[0]!.tools, []);
        assert(selectedModel.requests[1]!.messages.some(m => m.role === 'system' && m.content.some(b => b.type === 'text' && b.text.includes('IntelliSense:'))));
        assert(!JSON.stringify(agent.session.deriveMessages()).includes('IntelliSense:'));
        assert.equal(agent.session.requestHeader()!.config.provider, 'mock-account');
        assert(frozenRequest && Object.isFrozen(frozenRequest));
        assert.equal(frozenRequest.provider, 'mock-account');
        assert(agent.session.deriveMessages().at(-1)!.content.some(b => b.type === 'text' && b.text === '8' && !b.text.includes('<|INTELLISENSE|>')));
        // Auxiliary LLM calls and ordinary agents must retain their normal provider behavior.
        selectedModel.responses.push('session title');
        let title = '';
        for await (const chunk of ctx.llm.stream({ provider: 'mock-account', model: 'selected', sessionId: agent.id, purpose: 'session-title', messages: [] })) {
            if (chunk.type === 'text-delta') title += chunk.text;
        }
        assert.equal(title, 'session title');
        const nativeAgent = await ctx.agentLoop.create(SessionId('native'), { provider: 'mock-account', model: 'selected' });
        selectedModel.responses.push('native prose');
        nativeAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'native response' }], source: { kind: 'user' } }));
        await nativeAgent.whenIdle();
        assert(nativeAgent.session.deriveMessages().at(-1)!.content.some(b => b.type === 'text' && b.text === 'native prose'));
        selection.current = { provider: 'ts-repl', model: 'test', reasoningEffort: undefined };
        // An independent native guard still denies an enabled semantic function.
        ctx.tools.guard(() => 'Native policy denial');
        model.responses.push('await std.fs.read({path: "b"})');
        await send('try denied tool');
        assert.equal(invocations, 1); assert(errors.length > 0);
        const denial = events.filter(e => e.type === 'tool/ptc-dispatch').at(-1)!;
        assert.equal(denial.data.isError, true);
        assert.match(JSON.stringify(denial.data.content), /Native policy denial/);
        const failure = events.filter(e => e.type === 'tool/result').at(-1)!;
        assert.equal(failure.data.message.isError, true);
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
