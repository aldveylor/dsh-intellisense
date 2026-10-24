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
import * as plugin from '../../src/index.js';
import * as namespacePlugin from '../../src/integration/namespace_plugin.js';
import * as presentation from '../../src/integration/presentation.js';

/** @brief Capture assembled requests and reply without external model access. */
class ScriptedModel extends LlmAdapter {
    requests: GenerateOptions[] = [];

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        const text = '```js:exec\nreturn 42;\n```';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

/** @brief Read the native loop's assembled system messages. */
function systemOf(request: GenerateOptions): string {
    return request.messages.filter(message => message.role === 'system').map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('\n')).join('\n');
}

for (const mode of ['standard', 'native', 'ptc'] as const) {
    test(`full plugin assembly preserves persona and exposes the ${mode} tool set`, { timeout: 10_000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'namespace-integration-'));
        const ctx = new Context();
        try {
            await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
            await ctx.plugin(SystemPrompt, { personaPrefix: 'Preserve the original persona.' });
            await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
            await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
            const routes = new Map<string, ConnectionFetchRoute>();
            ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path); }; } } });
            ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
            ctx.tools.register(defineTool({ name: 'read_file', description: 'Read a file', parameters: {},
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'contents' }));
            const model = new ScriptedModel(); ctx.llm.registerAdapter(['fake'], model);
            const mounted = mode === 'native' ? await ctx.plugin(namespacePlugin) : await ctx.plugin(plugin, { timeoutMs: 3000 });
            assert.equal(routes.size, 3);
            const agent = await ctx.agentLoop.create(SessionId(`integration-${mode}`), { provider: 'fake', model: 'scripted' });
            const namespaces = ctx.commandNamespaces;
            assert.equal(namespaces.enabled(agent), false);
            if (mode !== 'standard') {
                await agent.ctx.plugin(presentation, { mode });
                await namespaces.configure(agent);
            }
            const errors: unknown[] = [];
            ctx.on('agent/error', ({ error }) => { errors.push(error); });
            const send = async () => {
                agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect available commands.' }], source: { kind: 'user' } }));
                await agent.whenIdle();
                assert.deepEqual(errors, []);
            };
            await send();
            assert.equal(model.requests.length, 1, 'Code fences do not trigger execution or synthetic continuations');
            const request = model.requests[0]!;
            assert(systemOf(request).includes('Preserve the original persona.'));
            const names = request.tools?.map(tool => tool.name) ?? [];
            if (mode === 'standard') {
                assert(names.includes('read_file'));
                assert(!systemOf(request).includes('Use tools.intellisense'));
                assert.equal(ctx.get('codeRuntime'), undefined);
            } else if (mode === 'ptc') {
                assert.deepEqual(names, ['tools_run_code']);
                assert(systemOf(request).includes('Each execution uses a fresh context'));
                assert(systemOf(request).includes('function intellisense('));
                const execution = await agent.ctx.tools.execute({ agent, callId: ToolCallId('integration-code'), name: 'tools_run_code', arguments: { code: 'return 42;', description: 'Check scoped runtime' }, signal: new AbortController().signal });
                assert.equal(execution.isError, false, JSON.stringify(execution));
                assert.deepEqual(execution.value, { logs: [], result: 42 });
            } else {
                assert.deepEqual(names, ['ns_tools__intellisense']);
                assert.equal(agent.ctx.get('codeRuntime'), undefined);
                assert(!systemOf(request).includes('TypeScript/JavaScript'));
                const info = JSON.parse(await namespaces.discover(agent, ['std.fs.read']));
                assert(info.members.some((member: { tool: string }) => member.tool === 'ns_std__ns_fs__read'));
                await send();
                assert(model.requests[1]!.tools?.some(tool => tool.name === 'ns_std__ns_fs__read'));
            }
            assert(!agent.session.snapshotEvents().some(event => String(event.type) === 'plugin:ts_intellisense/rewrite'));
            await mounted.dispose();
            assert.equal(ctx.get('commandNamespaces'), undefined);
        } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
    });
}
