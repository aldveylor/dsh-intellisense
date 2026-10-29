import { dshCompatibility } from '../../src/compatibility/compatibility.js';
import { executeTool } from './tool_execution.js';
import { configureSession, publishSessionFixture } from '../registry/session_fixture.js';
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
import * as profilesPlugin from '../../src/profile/plugin.js';
import * as namespacePlugin from '../../src/integration/plugin.js';
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
            await ctx.plugin(ToolRuntime); await ctx.plugin({ inject: ['tools'], apply: (scope: Context) => { dshCompatibility.configureTools(scope); } }); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
            await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
            const routes = new Map<string, ConnectionFetchRoute>();
            ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path); }; } } });
            ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
            ctx.tools.register(defineTool({ name: 'read_file', description: 'Read a file\nComplete file documentation.', parameters: {},
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'contents' }));
            const presets = new Map<string, unknown>();
            if (mode === 'ptc') ctx.provide('agentPresets', { list: async () => [], register: async (preset: { id: string }) => {
                presets.set(preset.id, preset);
                return () => { presets.delete(preset.id); };
            } });
            const model = new ScriptedModel(); ctx.llm.registerAdapter(['fake'], model);
            const mountedProfiles = mode === 'native' ? await ctx.plugin(profilesPlugin) : undefined;
            const mounted = mode === 'native' ? await ctx.plugin(namespacePlugin) : await ctx.plugin(plugin, { timeoutMs: 3000 });
            assert.equal(presets.size, 0, 'The main component does not register agent presets');
            assert.deepEqual([...routes.keys()].sort(), ['/api/ts-intellisense', '/api/ts-intellisense-client', '/api/ts-intellisense-docs-image', '/api/ts-intellisense-profile', '/api/ts-intellisense-state']);
            const agent = await ctx.agentLoop.create(SessionId(`integration-${mode}`), { provider: 'fake', model: 'scripted' });
            const namespaces = ctx.namespaceIntegration;
            assert.equal(namespaces.enabled(agent), false);
            if (mode !== 'standard') {
                await agent.ctx.plugin(presentation, { mode });
                await configureSession(namespaces, agent, [{ id: 'read_file', path: 'std.fs.read', description: 'Read file contents', pinned: false }]);
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
                assert(!systemOf(request).includes('Use tools.inspect'));
                assert.equal(ctx.get('codeRuntime'), undefined);
            } else if (mode === 'ptc') {
                assert.deepEqual(names, ['tools_run_code']);
                assert(systemOf(request).includes('globalThis'));
                assert(systemOf(request).includes('function inspect('));
                assert(systemOf(request).includes('namespace tools {  // Tool discovery and Profile management'));
                const execution = await executeTool(agent.ctx.tools, { agent, callId: ToolCallId('integration-code'), name: 'tools_run_code', arguments: { code: 'return 42;', description: 'Check scoped runtime' }, signal: new AbortController().signal });
                assert.equal(execution.isError, false, JSON.stringify(execution));
                assert.deepEqual(execution.value, { logs: [], result: 42 });
            } else {
                assert.deepEqual(names, ['ns_tools__inspect']);
                assert.equal(agent.ctx.get('codeRuntime'), undefined);
                assert(!systemOf(request).includes('TypeScript/JavaScript'));
                let discoverySequence = 0;
                const discover = async (queries: string[]) => {
                    const result = await executeTool(agent.ctx.tools, { agent, callId: ToolCallId(`integration-discovery-${++discoverySequence}`), name: 'ns_tools__inspect', arguments: { queries }, signal: new AbortController().signal });
                    assert.equal(result.isError, false, JSON.stringify(result));
                    return JSON.parse(result.value as string);
                };
                const roots = await discover(['']);
                assert(!JSON.stringify(roots).includes('Complete file documentation.'));
                assert.equal(roots.members.find((member: { path: string }) => member.path === 'tools').brief, 'Tool discovery and Profile management');
                const listing = await discover(['global.std.fs.']);
                assert.deepEqual(listing.members, [{ path: 'std.fs.read', brief: 'Read file contents' }]);
                await send();
                assert.deepEqual(model.requests[1]!.tools?.map(tool => tool.name), ['ns_tools__inspect']);
                const info = await discover(['global.std.fs.read']);
                assert(info.members.some((member: { path: string }) => member.path === 'std.fs.read'));
                assert(info.members.every((member: object) => !Object.hasOwn(member, 'tool')));
                assert.equal(info.members[0].brief, 'Read file contents');
                assert.match(info.members[0].description, /Complete file documentation\./);
                assert(Object.hasOwn(info.members[0], 'parameters'));
                await send();
                assert.deepEqual(model.requests[2]!.tools?.map(tool => tool.name).sort(), ['ns_std__fs__read', 'ns_tools__inspect']);
                const addition = await namespaces.addition(agent);
                const configuration = addition.profile.snapshot;
                for (const path of ['tools.inspect', 'tools']) {
                    const draft = configuration.clone();
                    draft.resolve(path)!.setDisabled(true);
                    (draft.resolve('std.fs.read') as import('../../src/profile/function.js').ProfileFunction).setFixedLevel(2);
                    await publishSessionFixture(namespaces, agent, draft);
                    await namespaces.configurationChanged(agent);
                    await send();
                    const disabledRequest = model.requests.at(-1)!;
                    const prompt = systemOf(disabledRequest);
                    assert(!prompt.includes('Use tools.inspect'), prompt);
                    assert(!prompt.includes('Query an exact command path'), prompt);
                    assert(!prompt.includes('Mounted command names start with ns_'), prompt);
                    assert(!prompt.includes('Call native DSML tools'), prompt);
                    assert.deepEqual(disabledRequest.tools?.map(tool => tool.name), ['ns_std__fs__read']);
                }
                await publishSessionFixture(namespaces, agent, configuration);
                await namespaces.configurationChanged(agent);
                await send();
                assert(systemOf(model.requests.at(-1)!).includes('Use tools.inspect'));
                const brief = configuration.clone();
                (brief.resolve('std.fs.read') as import('../../src/profile/function.js').ProfileFunction).setFixedLevel(1);
                (brief.resolve('tools.profile.load') as import('../../src/profile/function.js').ProfileFunction).setFixedLevel(1);
                await publishSessionFixture(namespaces, agent, brief);
                await namespaces.configurationChanged(agent);
                await send();
                const briefRequest = model.requests.at(-1)!;
                const briefPrompt = systemOf(briefRequest);
                assert(briefPrompt.includes('"path": "std.fs.read"'), briefPrompt);
                assert(briefPrompt.includes('"path": "tools.profile.load"'), briefPrompt);
                assert(!briefPrompt.includes('```ts:namespace'), briefPrompt);
                assert(!briefRequest.tools?.some(tool => tool.name === 'ns_tools__profile__load'));
            }
            assert(!agent.session.snapshotEvents().some(event => String(event.type) === 'plugin:ts_intellisense/rewrite'));
            await mounted.dispose();
            if (mountedProfiles) {
                assert(ctx.get('toolsNamespace'));
                await mountedProfiles.dispose();
            }
            assert.equal(ctx.get('toolsNamespace'), undefined);
            assert.equal(presets.size, 0);
        } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
    });
}
