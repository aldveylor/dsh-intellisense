import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createSystemMessage, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as plugin from '../../src/index.js';

/** @brief Capture actual upstream requests while returning executable conversational answers. */
class PromptModel extends LlmAdapter {
    requests: GenerateOptions[] = [];

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: '"answer"' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '"answer"' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

/** @brief Inspect both native system prompt transports without discarding admitted history. */
function systemText(request: GenerateOptions): string {
    return [request.system, ...request.messages.filter(message => message.role === 'system').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))].filter(Boolean).join('\n\n');
}

test('REPL replaces tool guidance while preserving personas, mode changes and system history', { timeout: 30_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-prompt-'));
    const ctx = new Context();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: 'Preset persona.' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] });
        await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        ctx.provide('connection', { fetch: { register: () => () => {} } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
        let planning = true;
        ctx.systemPrompt.section({ name: 'plan:policy', order: 500, text: () => planning ? 'Plan before changing files.' : '' });
        ctx.systemPrompt.section({ name: 'tool:read', order: 1100, text: 'Legacy read guidance.' });
        ctx.systemPrompt.section({ name: 'tools:sdk', order: 5000, text: 'Legacy SDK guidance.' });
        const model = new PromptModel();
        ctx.llm.registerAdapter(['mock'], model);
        await ctx.plugin(plugin, { provider: 'mock', model: 'test' });
        const errors: unknown[] = [];
        ctx.on('agent/error', ({ error }) => { errors.push(error); });
        const agent = await ctx.agentLoop.create(SessionId('prompt-injection'), { provider: 'ts-repl', model: 'test' });
        /** @brief Exercise the real loop and inspect its admitted upstream request. */
        const send = async (text: string) => {
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
            await agent.whenIdle();
            assert.deepEqual(errors, []);
            return model.requests.at(-1)!;
        };
        const first = await send('hello');
        assert.match(systemText(first), /Preset persona/);
        assert.match(systemText(first), /Plan before changing files/);
        assert.match(systemText(first), /persistent TypeScript REPL/);
        assert.doesNotMatch(systemText(first), /Legacy read guidance|Legacy SDK guidance/);
        assert.deepEqual(first.tools, []);
        planning = false;
        assert.doesNotMatch(systemText(await send('leave planning')), /Plan before changing files/);
        planning = true;
        assert.match(systemText(await send('resume planning')), /Plan before changing files/);
        agent.ctx.systemPrompt.section({ name: 'complete-persona', order: 0, complete: true, text: 'Complete minimal persona.' });
        const complete = await send('minimal reply');
        assert.match(systemText(complete), /Complete minimal persona/);
        assert.equal(systemText(complete).match(/persistent TypeScript REPL/g)?.length, 1);
        const history = createSystemMessage('Admitted system history.');
        for await (const _chunk of ctx.llm.stream({ provider: 'ts-repl', model: 'test', sessionId: agent.id, system: 'Direct system prompt.', messages: [history] })) { /* Drain execution. */ }
        const direct = model.requests.at(-1)!;
        assert.match(direct.system!, /Direct system prompt/);
        assert(direct.messages.includes(history));
        const native = await ctx.agentLoop.create(SessionId('native-prompt'), { provider: 'mock', model: 'test' });
        native.followup(createUserMessage({ content: [{ type: 'text', text: 'native reply' }], source: { kind: 'user' } }));
        await native.whenIdle();
        assert.deepEqual(errors, []);
        const nativeText = systemText(model.requests.at(-1)!);
        assert.match(nativeText, /Legacy read guidance/);
        assert.match(nativeText, /Legacy SDK guidance/);
        assert.doesNotMatch(nativeText, /persistent TypeScript REPL/);
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
