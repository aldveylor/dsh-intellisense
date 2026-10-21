import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as plugin from '../../src/index.js';

/** @brief Deterministic agent programs inspect real results, recover from errors and retain selected state. */
class FeedbackModel extends LlmAdapter {
    requests: GenerateOptions[] = [];
    codes = [
        'const result = await unknown.read({path: "a"}); vm.print(result)',
        'const retained = {label: result}; let progress = 1; throw new Error("need recovery")',
        'progress += 1; vm.restart(["retained", "progress"])',
        'vm.print(retained.label, progress)',
        '"读取完成。"',
    ];

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const text = this.codes[this.requests.length];
        assert(text, 'agent continued after its final reply');
        this.requests.push(options);
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

test('agent reads prints and runtime errors, restarts with selected state, and only the final reply reaches chat', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-vm-feedback-'));
    const ctx = new Context();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        ctx.provide('connection', { fetch: { register: () => () => {} } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
        let calls = 0;
        ctx.tools.register(defineTool({ name: 'read', description: 'Read a file', parameters: { path: { type: 'string', required: true } },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { calls++; return 'contents'; },
        }));
        const model = new FeedbackModel(); ctx.llm.registerAdapter(['mock'], model);
        await ctx.plugin(plugin, { provider: 'mock', model: 'test' });
        const agent = await ctx.agentLoop.create(SessionId('vm-feedback'), { provider: 'ts-repl', model: 'test' });
        const events: SessionEvent[] = [];
        const errors: unknown[] = [];
        const chunks: StreamChunk[] = [];
        let firstRequest: GenerateOptions | undefined;
        ctx.on('llm/stream', (request, next) => {
            if (!firstRequest && isAgentLoopRequest(request) && request.sessionId === agent.id) firstRequest = request;
            return next();
        }, { prepend: true });
        ctx.on('session/event', (session, event) => { if (session.id === agent.id) events.push(event); });
        ctx.on('agent/error', ({ error }) => { errors.push(error); });
        ctx.on('agent/assistant-stream', ({ agent: current, frame }) => { if (current.id === agent.id && frame.type === 'chunk') chunks.push(frame.chunk); });
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the file' }], source: { kind: 'user' } }));
        await agent.whenIdle();
        assert.deepEqual(errors, []);
        assert.equal(calls, 1);
        assert.equal(model.requests.length, 5);
        assert.match(JSON.stringify(model.requests[1]!.messages), /vm.print: contents/);
        assert.match(JSON.stringify(model.requests[2]!.messages), /VM error: need recovery/);
        assert.match(JSON.stringify(model.requests[3]!.messages), /vm.restart completed/);
        assert.match(JSON.stringify(model.requests[4]!.messages), /vm.print: contents 2/);
        assert(model.requests.every(request => request.tools?.length === 0));
        const visible = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text);
        assert.deepEqual(visible, ['读取完成。']);
        const root = events.find(event => event.type === 'tool/result');
        assert(root?.type === 'tool/result');
        assert.deepEqual((root.data.meta as { codes: string[] }).codes, model.codes);
        const assistant = events.filter(event => event.type === 'assistant/message');
        assert.equal(assistant.length, 2, 'one complete REPL call and one final reply');
        const executions = events.filter(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'VM_EXECUTE');
        assert.equal(executions.length, 5);
        assert.equal(executions.filter(event => event.type === 'tool/ptc-dispatch' && event.data.isError).length, 1);
        assert(events.some(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'read'));
        assert(firstRequest);
        const count = events.length;
        const cached: string[] = [];
        for await (const chunk of ctx.llm.stream(firstRequest)) if (chunk.type === 'text-delta') cached.push(chunk.text);
        assert.deepEqual(cached, ['读取完成。']);
        assert.equal(events.length, count);
        assert.equal(model.requests.length, 5);
        assert.equal(calls, 1);
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
