import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createSystemMessage, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent';
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
    response = '"answer"';

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: this.response };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: this.response } };
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
        const existing = await ctx.agentLoop.create(SessionId('existing-prompt'), { provider: 'mock', model: 'test' });
        await ctx.plugin(plugin);
        const errors: unknown[] = [];
        ctx.on('agent/error', ({ error }) => { errors.push(error); });
        const agent = await ctx.agentLoop.create(SessionId('prompt-injection'), { provider: 'mock', model: 'test' });
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
        for await (const _chunk of ctx.llm.stream({ provider: 'mock', model: 'test', sessionId: agent.id, system: 'Direct system prompt.', messages: [history] })) { /* Drain execution. */ }
        const direct = model.requests.at(-1)!;
        assert.equal(direct.system, 'Direct system prompt.');
        assert.doesNotMatch(systemText(direct), /persistent TypeScript REPL/);
        assert(direct.messages.includes(history));
        const native = await ctx.agentLoop.create(SessionId('native-prompt'), { provider: 'mock', model: 'test' });
        model.response = 'const remembered = 7; remembered';
        native.followup(createUserMessage({ content: [{ type: 'text', text: 'native reply' }], source: { kind: 'user' } }));
        await native.whenIdle();
        assert.deepEqual(errors, []);
        const nativeText = systemText(model.requests.at(-1)!);
        assert.doesNotMatch(nativeText, /Legacy read guidance|Legacy SDK guidance/);
        assert.match(nativeText, /persistent TypeScript REPL/);
        assert.equal(model.requests.at(-1)!.provider, 'mock');
        assert.equal(model.requests.at(-1)!.model, 'test');
        assert.deepEqual(model.requests.at(-1)!.tools, []);
        const selected = new PromptModel();
        selected.response = 'remembered + 1';
        ctx.llm.registerAdapter(['selected-account'], selected);
        installModelSelection(native.ctx, { assembled: undefined, current: { provider: 'selected-account', model: 'selected-model', reasoningEffort: undefined } });
        native.followup(createUserMessage({ content: [{ type: 'text', text: 'switch route' }], source: { kind: 'user' } }));
        await native.whenIdle();
        assert.deepEqual(errors, []);
        assert.equal(selected.requests.length, 1);
        assert.equal(selected.requests[0]!.provider, 'selected-account');
        assert.equal(selected.requests[0]!.model, 'selected-model');
        assert.deepEqual(selected.requests[0]!.tools, []);
        assert.match(systemText(selected.requests[0]!), /const remembered: 7/);
        assert(native.session.deriveMessages().at(-1)!.content.some(block => block.type === 'text' && block.text === '8'));
        selected.response = 'session title';
        let title = '';
        for await (const chunk of ctx.llm.stream({ provider: 'selected-account', model: 'selected-model', sessionId: native.id, purpose: 'session-title', messages: [] })) {
            if (chunk.type === 'text-delta') title += chunk.text;
        }
        assert.equal(title, 'session title');
        assert.doesNotMatch(systemText(selected.requests.at(-1)!), /persistent TypeScript REPL/);
        model.response = '"answer"';
        existing.followup(createUserMessage({ content: [{ type: 'text', text: 'existing reply' }], source: { kind: 'user' } }));
        await existing.whenIdle();
        assert.deepEqual(errors, []);
        assert.match(systemText(model.requests.at(-1)!), /persistent TypeScript REPL/);
        const child = await ctx.agents.create({ sessionId: SessionId('native-child'), parentAgent: native, meta: { origin: 'subagent' }, agentOptions: { provider: 'mock', model: 'test' } });
        child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'structured child' }], source: { kind: 'user' } }));
        await child.agent.whenIdle();
        assert.deepEqual(errors, []);
        const childText = systemText(model.requests.at(-1)!);
        assert.match(childText, /Legacy read guidance/);
        assert.match(childText, /Legacy SDK guidance/);
        assert.doesNotMatch(childText, /persistent TypeScript REPL/);
        await child.dispose();
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
