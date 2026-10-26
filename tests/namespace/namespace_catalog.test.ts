import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Register a minimal physical command in a real global or preset scope. */
function register(ctx: Context, name: string): void {
    ctx.tools.register(defineTool({ name, description: name, parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => name,
    }));
}

test('editor discovers standing preset tools without live agents and keeps execution scoped', async () => {
    const ctx = new Context();
    try {
        ctx.provide('systemPrompt', { tools: () => () => {} });
        await ctx.plugin(ToolRuntime);
        let toolContext = ctx;
        await ctx.plugin({ inject: ['tools'], apply: (injected: Context) => { toolContext = injected; } });
        const first = {}, second = {};
        const firstScope = createScope(toolContext, first), secondScope = createScope(toolContext, second);
        register(ctx, 'working_directory');
        register(firstScope.ctx, 'read_file');
        register(secondScope.ctx, 'write_file');
        const released: string[] = [];
        ctx.provide('agents', { list: () => [] });
        ctx.provide('agentPresets', {
            list: async () => [{ id: 'first' }, { id: 'second' }, { id: 'broken', broken: 'Unavailable' }],
            acquireScope: async (id: string) => {
                assert.notEqual(id, 'broken');
                return { key: id === 'first' ? first : second, [Symbol.asyncDispose]: async () => { released.push(id); } };
            },
        });
        const store = new MemoryStore(), registry = new SemanticRegistry(store);
        const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), []);
        await component.refresh();
        await registry.configure([
            { id: 'read_file', path: 'fs.read', aliases: [], pinned: false },
            { id: 'write_file', path: 'fs.write', aliases: [], pinned: false },
        ], 0);
        assert.deepEqual(registry.tools().map(tool => tool.id).sort(), ['read_file', 'working_directory', 'write_file']);
        assert.deepEqual(released, ['first', 'second']);
        assert.deepEqual(component.physical().map(tool => tool.id), ['working_directory']);
        const agent = { id: 'first-session' } as Agent;
        Object.assign(agent, { ctx: createScope(toolContext, agent, { parent: first }).ctx });
        const scoped = await component.registryFor(agent);
        assert.deepEqual(scoped.tools().map(tool => tool.id).sort(), ['read_file', 'working_directory']);
        assert.deepEqual((await component.entries(agent)).map(entry => entry.path), ['fs.read']);
        assert.deepEqual(scoped.configuration().mappings.map(mapping => mapping.path), ['fs.read', 'fs.write']);
        // An unavailable mapping becomes usable again when its physical tool is mounted.
        register(agent.ctx, 'write_file');
        assert.deepEqual((await component.entries(agent)).map(entry => entry.path).sort(), ['fs.read', 'fs.write']);
    } finally { await ctx.fiber.dispose(); }
});

test('preset catalog leases are released when reading a tool fails', async () => {
    let released = false;
    const ctx = new Context();
    try {
        ctx.provide('systemPrompt', { tools: () => () => {} });
        await ctx.plugin(ToolRuntime);
        ctx.provide('agents', { list: () => [] });
        ctx.provide('agentPresets', {
            list: async () => [{ id: 'first' }],
            acquireScope: async () => ({ key: {}, [Symbol.asyncDispose]: async () => { released = true; } }),
        });
        const store = new MemoryStore(), registry = new SemanticRegistry(store);
        const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), []);
        component.physical = (_agent, scope) => { if (scope) throw new Error('Catalog read failed'); return []; };
        await assert.rejects(component.refresh(), /Catalog read failed/);
        assert(released);
    } finally { await ctx.fiber.dispose(); }
});

test('command briefs expose current session paths and aliases while excluding plugin builtins', async () => {
    const ctx = new Context();
    try {
        ctx.provide('systemPrompt', { tools: () => () => {} });
        await ctx.plugin(ToolRuntime);
        ctx.provide('agents', { list: () => [] });
        for (const name of ['read_file', 'write_file', 'unmounted', 'tools_intellisense', 'tools_profile_commands', 'tools_run_code']) register(ctx, name);
        const store = new MemoryStore(), registry = new SemanticRegistry(store);
        const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), [{ tool: 'read_file', path: 'text.read' }]);
        await component.refresh();
        await registry.configure([
            { id: 'read_file', path: 'fs.read', aliases: ['fs.cat'], pinned: false },
            { id: 'write_file', path: 'fs.write', aliases: [], pinned: false },
        ], 0);
        const agent = { id: 'session', ctx } as Agent;
        const session = await component.registryFor(agent);
        await session.configure([
            { id: 'read_file', path: 'files.read', aliases: ['files.cat', 'hidden.read'], pinned: false },
            { id: 'write_file', path: 'files.write', aliases: [], pinned: false, disabled: true },
        ], session.snapshot().revision, [{ path: 'hidden', description: '', alwaysVisible: false, disabled: true }]);
        await component.statistics.recordCall(agent.id, 'read_file');
        const expected = [
            { name: 'read_file', brief: 'read_file', paths: ['files.read', 'files.cat', 'text.read'], totalCalls: 1 },
            { name: 'write_file', brief: 'write_file', paths: [], totalCalls: 0 },
            { name: 'unmounted', brief: 'unmounted', paths: [], totalCalls: 0 },
        ];
        assert.deepEqual(await component.commandBriefs(agent), expected);
        assert.deepEqual((await component.values(agent))['tools.profile.commands'], expected);
        assert.deepEqual((await component.commandBriefs())[0]?.paths, ['fs.read', 'fs.cat', 'text.read']);
    } finally { await ctx.fiber.dispose(); }
});
