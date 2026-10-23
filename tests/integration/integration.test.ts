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
import ToolRuntime, { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../../src/index.js';

/** @brief Script the real native loop without making external model requests. */
class ScriptedModel extends LlmAdapter {
    codes: string[] = [];
    requests: GenerateOptions[] = [];
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        this.requests.push(options);
        const text = this.codes.shift();
        assert.notEqual(text, undefined, 'Unexpected upstream continuation');
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: text! };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: text! } };
        yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}

/** @brief Read the actual loop-owned system-role prompt rather than the one-shot compatibility field. */
function systemOf(request: GenerateOptions): string {
    return request.messages.filter(message => message.role === 'system').map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('\n')).join('\n');
}

test('new mode executes through the native loop, audits guarded children and projects results; unload removes route and exec', { timeout: 20_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'text-ptc-'));
    const ctx = new Context();
    try {
        await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, { personaPrefix: '' }); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: directory });
        const routes = new Map<string, ConnectionFetchRoute>();
        ctx.provide('connection', { fetch: { register: (route: ConnectionFetchRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path); }; } } });
        ctx.provide('subagents', { startActivation: async () => { throw new Error('Unused'); } });
        const executions: ToolExecution[] = [];
        ctx.on('tools/pre-execute', async (execution, next) => { executions.push(execution); return next(); });
        let reads = 0;
        ctx.tools.register(defineTool({ name: 'read_file', description: 'Read a file', parameters: { path: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { reads++; return 'contents'; } }));
        const model = new ScriptedModel(); ctx.llm.registerAdapter(['fake'], model);
        const mounted = await ctx.plugin(plugin, { timeoutMs: 3000 });
        assert(ctx.tools.get('exec'));
        assert(ctx.llm.listProviders().some(provider => provider.id === 'text-ptc'));
        const agent = await ctx.agentLoop.create(SessionId('active-text-ptc'), { provider: 'fake', model: 'scripted' });
        const errors: unknown[] = [];
        ctx.on('agent/error', ({ error }) => { errors.push(error); });
        const send = async (codes: string[]) => {
            model.codes = codes;
            agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the file' }], source: { kind: 'user' } }));
            await agent.whenIdle();
            assert.deepEqual(errors, []);
            assert.equal(model.codes.length, 0);
        };
        await send(['Reading.\n```ts:exec\nconst text: string=await std.fs.read({path:"a"});globalThis.count=1;console.log("Got %s",text);return text;\n```', 'The file contains contents.']);
        assert.equal(reads, 1);
        const parent = executions.find(execution => execution.name === 'exec')!;
        const child = executions.find(execution => execution.name === 'read_file')!;
        assert(parent && child); assert.equal(child.parent, parent.token); assert.equal(child.rootCallId, parent.callId);
        assert(!systemOf(model.requests[0]!).includes('persistent TypeScript REPL'));
        assert(!systemOf(model.requests[0]!).includes('console.log —'));
        assert(systemOf(model.requests[0]!).includes('restart: Function;'));
        assert(systemOf(model.requests[0]!).includes('strict AsyncFunction'));
        assert(model.requests.every(request => !request.tools?.some(tool => tool.name === 'exec')));
        const projected = JSON.stringify(model.requests[1]!.messages);
        assert(projected.includes('exec-result')); assert(projected.includes('Got contents'));
        assert(!model.requests[1]!.messages.some(message => message.role === 'tool'));
        await send(['```js:exec\nreturn [typeof text,globalThis.count,typeof vm.print];\n```', 'The local variable is gone and global state remains.']);
        assert(JSON.stringify(model.requests.at(-1)!.messages).includes('undefined'));
        const guard = ctx.tools.guard(execution => execution.name === 'read_file' ? 'Denied by native guard' : undefined);
        await send(['```js:exec\ntry{return await std.fs.read({path:"b"})}catch(error){return error.message}\n```', 'The read was denied.']);
        guard(); assert.equal(reads, 1);
        assert(JSON.stringify(model.requests.at(-1)!.messages).includes('Denied by native guard'));
        await send(['```js:exec\nreturn std.fs.read<|INTELLISENSE|>', '({path:"c"});\n```', 'Read completed.']);
        assert.equal(reads, 2);
        await send(['```js:exec\nreturn typeof tools;\n```', 'The tools namespace is disabled.']);
        assert(JSON.stringify(model.requests.at(-1)!.messages).includes('undefined'));
        assert(model.requests.every(request => request.tools?.length === 0));
        assert(systemOf(model.requests[0]!).includes('## 命名空间'));
        assert(systemOf(model.requests[0]!).includes('std.cwd<|INTELLISENSE|>'));
        assert(systemOf(model.requests[0]!).includes("Use the language of the user's human-authored request"));
        assert(agent.session.snapshotEvents().some(event => event.type === 'system/message' && JSON.stringify(event.data).includes('## 命名空间')));
        const events = agent.session.snapshotEvents();
        assert(events.some(event => event.type === 'exec/intellisense'));
        assert(events.some(event => event.type === 'exec/rewrite'));
        assert(events.some(event => event.type === 'tool/ptc-dispatch-start'));
        assert(events.some(event => event.type === 'tool/ptc-dispatch'));
        const routed = await ctx.agentLoop.create(SessionId('routed-text-ptc'), { provider: 'text-ptc', model: 'fake/scripted' });
        model.codes = ['Routed answer.'];
        routed.followup(createUserMessage({ content: [{ type: 'text', text: 'Answer through the Text PTC provider.' }], source: { kind: 'user' } }));
        await routed.whenIdle();
        assert.deepEqual(errors, []);
        assert.equal(model.codes.length, 0);
        assert.equal(model.requests.at(-1)!.provider, 'fake');
        assert.equal(model.requests.at(-1)!.model, 'scripted');
        await mounted.dispose();
        assert.equal(ctx.tools.get('exec'), undefined);
        assert.equal(ctx.get('codeRuntime'), undefined);
        assert(!ctx.llm.listProviders().some(provider => provider.id === 'text-ptc'));
    } finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
});
