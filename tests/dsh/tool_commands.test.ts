import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection';
import type { Agent } from '@deepseek-ai/dsh-agent';
import * as plugin from '../../src/index.js';

/** @brief Drive actual worker IPC, tool dispatch and profile-context continuations. */
class CommandModel extends LlmAdapter {
    codes: string[] = [];
    requests: GenerateOptions[] = [];

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        const text = this.codes.shift();
        assert(text, 'unexpected continuation');
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

test('commands edit only the caller, publish CoW profiles and apply a loaded profile within a running request', { timeout: 30_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-commands-'));
    const ctx = new Context();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        const routes = new Map<string, ConnectionFetchRoute>();
        ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => { routes.set(route.path, route); return () => {}; } } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
        let reads = 0;
        ctx.tools.register(defineTool({ name: 'read', description: 'Original read documentation', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { reads++; return 'contents'; } }));
        const model = new CommandModel(); ctx.llm.registerAdapter(['arbitrary-upstream'], model);
        await ctx.plugin(plugin);
        assert(!ctx.tools.get('tools_namespace'));
        const first = await ctx.agentLoop.create(SessionId('commands-first'), { provider: 'arbitrary-upstream', model: 'arbitrary-model' });
        const second = await ctx.agentLoop.create(SessionId('commands-second'), { provider: 'arbitrary-upstream', model: 'arbitrary-model' });
        let sequence = 0;
        const call = async (agent: Agent, name: string, args: object) => {
            const result = await agent.ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId(`command-${++sequence}`), signal: new AbortController().signal });
            assert(!result.isError, result.isError ? result.error.message : '');
            return result.isError ? undefined : result.value;
        };
        await call(first, 'tools_comment', { tool: 'unknown.read', comment: 'Read briefly' });
        await call(first, 'tools_fix', { tool: 'read' });
        await call(first, 'tools_mount', { source: 'unknown.read', node: 'work', name: 'read' });
        await call(first, 'tools_mount', { source: 'work.read', node: 'backup', name: 'read' });
        await call(first, 'tools_unmount', { target: 'work.read' });
        await call(first, 'tools_unmount', { target: 'unknown.read' });
        await call(first, 'tools_commit', { profile: 'Work' });
        assert.deepEqual(await call(first, 'tools_profiles', {}), { profiles: ['Default', 'Work'], current: 'Work' });
        const route = routes.get('/api/ts-intellisense-state')!;
        const send = async (agent: Agent, codes: string[]) => {
            model.codes = codes;
            const errors: unknown[] = [];
            const dispose = ctx.on('agent/error', ({ error }) => { errors.push(error); });
            agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }));
            await agent.whenIdle();
            dispose();
            assert.deepEqual(errors, []);
            assert.equal(model.codes.length, 0);
        };
        // The first call starts with unknown tools; load must refresh VM and the next upstream prompt.
        await send(second, ['await unknown.tools_loadprofile({profile: "Work"})', 'vm.print(await backup.read({}))', '"done"', '"done"']);
        assert.equal(reads, 1);
        const switched = model.requests[1]!;
        assert.match(switched.system!, /backup\.read/);
        assert.match(switched.system!, /Read briefly/);
        assert(switched.messages.some(message => message.role === 'system' && JSON.stringify(message).includes('Tool profile context updated')));
        assert.equal(switched.provider, 'arbitrary-upstream');
        assert.equal(switched.model, 'arbitrary-model');
        await call(first, 'tools_unmount', { target: 'backup.read' });
        await call(first, 'tools_commit', { profile: 'Work' });
        // Existing second keeps the old Work version after replacement.
        await send(second, ['await backup.read({})']);
        assert.equal(reads, 2);
        const global = await (await route.fetch(new Request('http://local/api/ts-intellisense-state'))).json();
        assert.equal(global.state.profile, 'Default');
        assert.deepEqual(global.state.mappings, []);
        assert(global.state.profiles.includes('Work'));
        const contexts = second.session.deriveMessages().filter(message => message.source.kind === 'ts-intellisense');
        assert(contexts.length > 0);
        assert(contexts.every(message => !JSON.stringify(message).includes('"path":"unknown.read"')));
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
