import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
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
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableFunction } from '../../src/profile/function.js';

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

for (const mode of ['native', 'ptc'] as const) {
    for (const preview of [false, true]) {
        test(`reused blank ${mode} sessions refresh old Profiles before ${preview ? 'preview' : 'first tool admission'}`, { timeout: 10_000 }, async () => {
            const directory = await mkdtemp(join(tmpdir(), 'namespace-preset-reuse-'));
            const ctx = new Context();
            try {
                await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
                await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(nativeExecutor);
                await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
                await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
                ctx.provide('connection', { fetch: { register: () => () => {} } });
                const resolveDescriptor = Object.getOwnPropertyDescriptor(ctx.tools, 'resolve');
                const assembleDescriptor = Object.getOwnPropertyDescriptor(ctx.systemPrompt, 'assemble');
                const mounted = await ctx.plugin(plugin, { timeoutMs: 3000 });
                ctx.tools.register(defineTool({ name: 'read_file', description: 'Read a file', parameters: {},
                    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'contents' }));
                const model = new ScriptedModel();
                ctx.llm.registerAdapter(['fake'], model);
                const agent = await ctx.agentLoop.create(SessionId(`reused-${mode}-${preview}`), { provider: 'fake', model: 'scripted' });
                const namespaces = ctx.namespaceIntegration;
                const name = preview ? 'Retired' : 'Default';
                if (preview) await ctx.toolsNamespace.create(name);
                await ctx.toolsNamespace.edit(name, snapshot => {
                    snapshot.create('fs', () => new EditableNamespace()).create('read', () => new EditableFunction()).setTool('read_file').setFixedLevel(2);
                    return snapshot;
                });
                const old = (await namespaces.profiles.load(agent.session, name)).profile;
                if (preview) await ctx.toolsNamespace.remove(name);
                else await ctx.toolsNamespace.edit('Default', snapshot => { snapshot.remove('fs'); return snapshot; });
                const latest = await ctx.toolsNamespace.reference('Default');
                const standing = createScope(ctx, {});
                await standing.ctx.plugin(presentation, { mode });
                const binding = bindScopeParent(agent, scopeOf(standing.ctx)!);
                // The preset registry commits this event after rebinding a reused blank Agent.
                ctx.emit('agent-preset/selected', agent.id, `intellisense${mode === 'ptc' ? '-ptc' : ''}`);
                const expected = mode === 'ptc' ? ['tools_run_code'] : ['ns_tools__inspect'];
                if (preview) {
                    assert.deepEqual((await ctx.systemPrompt.assemble({ agent, scope: agent })).tools.map(tool => tool.name), expected);
                    // A second selection of the same retained preset must also refresh a blank session.
                    await ctx.toolsNamespace.edit('Default', snapshot => snapshot.setBrief('Latest blank revision'));
                    ctx.emit('agent-preset/selected', agent.id, `intellisense${mode === 'ptc' ? '-ptc' : ''}`);
                }
                const errors: unknown[] = [];
                ctx.on('agent/error', ({ error }) => { errors.push(error); });
                agent.followup(createUserMessage({ content: [{ type: 'text', text: 'List the available tools.' }], source: { kind: 'user' } }));
                await agent.whenIdle();
                assert.deepEqual(errors, []);
                assert.deepEqual(model.requests[0]!.tools?.map(tool => tool.name), expected);
                const current = (await namespaces.addition(agent)).profile;
                assert.equal((await namespaces.addition(agent)).name, 'Default');
                assert(current.pointer > old.pointer);
                assert.equal(current.pointer, (await ctx.toolsNamespace.reference('Default')).pointer);
                if (!preview) assert.equal(current.pointer, latest.pointer);
                assert.equal(current.snapshot.resolve('fs'), undefined);
                assert.equal(ctx.tools.get('ns_fs__read', agent), undefined);
                if (mode === 'ptc') {
                    const result = await executeTool(agent.ctx.tools, { agent, callId: ToolCallId('check-removed-fs'), name: 'tools_run_code',
                        arguments: { code: 'return typeof fs;', description: 'Verify removed namespace' }, signal: new AbortController().signal });
                    assert.equal(result.isError, false, JSON.stringify(result));
                    assert.deepEqual(result.value, { logs: [], result: 'undefined' });
                }
                await ctx.toolsNamespace.edit('Default', snapshot => snapshot.setBrief('Changed after first turn'));
                const replacement = createScope(ctx, {});
                await replacement.ctx.plugin(presentation, { mode });
                binding.rebind(scopeOf(replacement.ctx)!);
                await namespaces.configure(agent);
                assert.equal((await namespaces.addition(agent)).profile.pointer, current.pointer, 'Started sessions keep their archived version');
                // Leaving the preset must remove session-owned native proxies from the standard catalog.
                const standard = createScope(ctx, {});
                binding.rebind(scopeOf(standard.ctx)!);
                const normal = await ctx.systemPrompt.assemble({ agent, scope: agent });
                assert(normal.tools.some(tool => tool.name === 'read_file'));
                assert(!normal.tools.some(tool => tool.name.startsWith('ns_')));
                await mounted.dispose();
                assert.deepEqual(Object.getOwnPropertyDescriptor(ctx.tools, 'resolve'), resolveDescriptor);
                assert.deepEqual(Object.getOwnPropertyDescriptor(ctx.systemPrompt, 'assemble'), assembleDescriptor);
            } finally {
                await ctx.fiber.dispose();
                await rm(directory, { recursive: true, force: true });
            }
        });
    }
}

/** @brief Read the native loop's assembled system messages. */
function systemOf(request: GenerateOptions): string {
    return request.messages.filter(message => message.role === 'system').map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('\n')).join('\n');
}

for (const [mode, timing] of [['standard', 'after'], ['native', 'before'], ['native', 'after'], ['native', 'inherited'], ['native', 'bound_after'], ['ptc', 'before'], ['ptc', 'after'], ['ptc', 'inherited'], ['ptc', 'bound_after']] as const) {
    test(`full plugin assembly exposes ${mode} tools with ${timing} presentation binding`, { timeout: 10_000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'namespace-integration-'));
        const ctx = new Context();
        try {
            await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
            await ctx.plugin(SystemPrompt, { personaPrefix: 'Preserve the original persona.' });
            await ctx.plugin(ToolRuntime); await ctx.plugin(nativeExecutor); await ctx.plugin(AgentRegistry); await ctx.plugin(AgentLoop, { agents: [] });
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
            const unrelated = await ctx.agentLoop.create(SessionId(`unrelated-${mode}`), { provider: 'fake', model: 'scripted' });
            const defaultExecutor = ctx.tools.selectExecutor(unrelated);
            const standing = timing === 'inherited' || timing === 'bound_after' ? createScope(ctx, {}) : undefined;
            if (standing && mode !== 'standard') await standing.ctx.plugin(presentation, { mode });
            const { agent } = await ctx.agents.create({
                sessionId: SessionId(`integration-${mode}`), agentOptions: { provider: 'fake', model: 'scripted' },
                ...(mode !== 'standard' && timing === 'before' ? { setup: async (scope: Context) => { await scope.plugin(presentation, { mode }); } } : {}),
                ...(standing && timing === 'inherited' ? { setup: (_scope: Context, child: import('@deepseek-ai/dsh-agent').Agent) => { bindScopeParent(child, scopeOf(standing.ctx)!); } } : {}),
            });
            const namespaces = ctx.namespaceIntegration;
            assert.equal(namespaces.enabled(agent), mode !== 'standard' && (timing === 'before' || timing === 'inherited'));
            if (standing && timing === 'bound_after') bindScopeParent(agent, scopeOf(standing.ctx)!);
            if (mode !== 'standard') {
                if (timing === 'after') await agent.ctx.plugin(presentation, { mode });
                const initial = await ctx.systemPrompt.assemble({ agent, scope: agent });
                assert.deepEqual(initial.tools.map(tool => tool.name), mode === 'ptc' ? ['tools_run_code'] : ['ns_tools__inspect']);
                assert.equal(ctx.tools.selectExecutor(unrelated), defaultExecutor, 'Other conversations keep their executor');
                await configureSession(namespaces, agent, [{ id: 'read_file', path: 'std.fs.read', description: 'Read file contents', pinned: false }]);
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
                const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fake', model: 'scripted' }, signal: new AbortController().signal });
                try {
                    const call = await executeTool(agent.ctx.tools, { agent, toolSet, callId: ToolCallId('integration-namespace-code'), name: 'tools_run_code',
                        arguments: { code: 'await tools.inspect(["std.fs.read"]); return await std.fs.read();', description: 'Discover and execute a hidden physical tool' }, signal: new AbortController().signal });
                    assert.equal(call.isError, false, JSON.stringify(call));
                    assert.deepEqual(call.value, { logs: [], result: 'contents' });
                } finally { toolSet.dispose(); }
                await send();
                assert.deepEqual(model.requests.at(-1)!.tools?.map(tool => tool.name), ['tools_run_code']);
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
