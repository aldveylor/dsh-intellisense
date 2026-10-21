import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as plugin from '../../src/index.js';

/** @brief Paused generation proves source is visible before validation or physical execution. */
class StreamingModel extends LlmAdapter {
    requests: GenerateOptions[] = [];
    afterPrefix?: () => Promise<void>;

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'reasoning-delta', index: 0, text: 'Read the file' };
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Read the file' } };
        yield { type: 'text-delta', index: 1, text: 'await unknown.re' };
        await this.afterPrefix?.();
        yield { type: 'text-delta', index: 1, text: 'ad({path: "a"})' };
        yield { type: 'block-end', index: 1, block: { type: 'text', text: 'await unknown.read({path: "a"})' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

test('native session streams source before executing once, records child schemas and replies with the final result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-trace-'));
    const ctx = new Context();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        ctx.provide('connection', { fetch: { register: () => () => {} } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
        const model = new StreamingModel(); ctx.llm.registerAdapter(['mock'], model);
        let invocations = 0;
        ctx.tools.register(defineTool({ name: 'read', description: 'Read a file', parameters: { path: { type: 'string', required: true } },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            execute: async () => { invocations++; return 'contents'; },
        }));
        await ctx.plugin(plugin, { provider: 'mock', model: 'test' });
        const agent = await ctx.agentLoop.create(SessionId('streaming-trace'), { provider: 'ts-repl', model: 'test' });
        const events: SessionEvent[] = [];
        let prefixSeen!: () => void;
        const preview = new Promise<void>(resolve => { prefixSeen = resolve; });
        model.afterPrefix = () => preview;
        ctx.on('session/event', (session, event) => {
            if (session.id !== agent.id) return;
            events.push(event);
            if (event.type === 'ts-repl/source' && event.data.text === 'await unknown.re') {
                assert.equal(invocations, 0);
                assert(!events.some(entry => entry.type === 'tool/call'));
                prefixSeen();
            }
        });
        const chunks: StreamChunk[] = [];
        ctx.on('agent/assistant-stream', ({ agent: current, frame }) => {
            if (current.id === agent.id && frame.type === 'chunk') chunks.push(frame.chunk);
        });
        const errors: unknown[] = [];
        ctx.on('agent/error', ({ error }) => { errors.push(error); });
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read a' }], source: { kind: 'user' } }));
        await agent.whenIdle();
        assert.deepEqual(errors, []);
        assert.equal(invocations, 1);
        assert.deepEqual(model.requests[0]?.tools, []);
        const edits = events.filter(event => event.type === 'ts-repl/source');
        let source = '';
        for (const edit of edits) source = source.slice(0, edit.data.offset) + edit.data.text;
        assert.equal(source, 'await unknown.read({path: "a"})');
        const call = events.find(event => event.type === 'tool/call');
        assert(call?.type === 'tool/call');
        assert(edits[0]!.seq < call.seq);
        assert.equal(edits[0]!.data.callId, call.data.callId);
        assert(!chunks.some(chunk => chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block.type === 'tool-call'));
        assert(chunks.some(chunk => chunk.type === 'reasoning-delta'));
        assert(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'contents'));
        assert(!chunks.some(chunk => chunk.type === 'text-delta' && chunk.text.includes('unknown.read')));
        const headers = events.filter(event => event.type === 'request/header');
        assert(headers.some(event => event.data.header.tools?.some(tool => tool.name === 'read' && tool.description === 'Read a file')));
        assert(events.some(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'read'));
    } finally {
        await ctx.fiber.dispose();
        await rm(directory, { recursive: true, force: true });
    }
});
