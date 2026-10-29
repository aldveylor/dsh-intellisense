import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { NamespaceComponent } from '../../src/profile/component.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
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
        const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(registry, store));
        await component.refresh();
        await registry.configure([
            { id: 'read_file', path: 'fs.read', pinned: false },
            { id: 'write_file', path: 'fs.write', pinned: false },
        ], 0);
        assert.deepEqual(registry.tools().map(tool => tool.id).sort(), ['read_file', 'working_directory', 'write_file']);
        assert.deepEqual(released, ['first', 'second']);
        assert.deepEqual(component.physical().map(tool => tool.id), ['working_directory']);
        const agent = { id: 'first-session', session: Session.create(SessionId('first-session')) } as Agent;
        Object.assign(agent, { ctx: createScope(toolContext, agent, { parent: first }).ctx });
        const scoped = await component.addition(agent);
        assert.deepEqual(component.physical(agent).map(tool => tool.id).sort(), ['read_file', 'working_directory']);
        assert.deepEqual((await component.entries(agent)).map(entry => entry.path), ['fs.read']);
        assert.equal(scoped.profile.snapshot.resolve('fs.write')?.type, 'command');
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
        const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(registry, store));
        component.physical = (_agent, scope) => { if (scope) throw new Error('Catalog read failed'); return []; };
        await assert.rejects(component.refresh(), /Catalog read failed/);
        assert(released);
    } finally { await ctx.fiber.dispose(); }
});

test('command briefs expose current session mount paths including disabled paths while excluding plugin builtins', async () => {
    const ctx = new Context();
    try {
        ctx.provide('systemPrompt', { tools: () => () => {} });
        await ctx.plugin(ToolRuntime);
        ctx.provide('agents', { list: () => [] });
        for (const name of ['read_file', 'write_file', 'unmounted', 'tools_inspect', 'tools_profile_commands', 'tools_run_code']) register(ctx, name);
        const store = new MemoryStore(), registry = new SemanticRegistry(store);
        const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, registry), registry, new ProfileSessions(registry, store), [{ tool: 'read_file', path: 'text.read' }]);
        await component.refresh();
        await registry.configure([
            { id: 'read_file', path: 'fs.read', pinned: false },
            { id: 'read_file', path: 'fs.cat', pinned: false },
            { id: 'write_file', path: 'fs.write', pinned: false },
        ], 0);
        const agent = { id: 'session', ctx, session: Session.create(SessionId('session')) } as Agent;
        await registry.configure([
            { id: 'read_file', path: 'files.read', pinned: false },
            { id: 'read_file', path: 'files.cat', pinned: false },
            { id: 'read_file', path: 'hidden.read', pinned: false },
            { id: 'write_file', path: 'files.write', pinned: false, disabled: true },
        ], registry.revision, [{ path: 'hidden', description: '', alwaysVisible: false, disabled: true }]);
        await component.addition(agent);
        await component.statistics.calls.increment(agent.id, ['read_file']);
        const expected = [
            { name: 'read_file', brief: 'read_file', paths: ['hidden.read', 'files.read', 'files.cat', 'text.read'], totalCalls: 1 },
            { name: 'write_file', brief: 'write_file', paths: ['files.write'], totalCalls: 0 },
            { name: 'unmounted', brief: 'unmounted', paths: [], totalCalls: 0 },
        ];
        assert.deepEqual(await component.commandBriefs(agent), expected);
        assert.deepEqual((await component.values(agent))['tools.profile.commands'], expected);
        assert.deepEqual((await component.commandBriefs())[0]?.paths, ['hidden.read', 'files.read', 'files.cat', 'text.read']);
    } finally { await ctx.fiber.dispose(); }
});

test('scope rebinding changes available contracts while retaining the same session pointer', async () => {
    const { bindScopeParent } = await import('@deepseek-ai/dsh-scope');
    const ctx = new Context();
    try {
        ctx.provide('systemPrompt', { tools: () => () => {} });
        ctx.provide('agents', { list: () => [] });
        await ctx.plugin(ToolRuntime);
        let toolContext = ctx;
        await ctx.plugin({ inject: ['tools'], apply: (injected: Context) => { toolContext = injected; } });
        const firstKey = {}, secondKey = {};
        const first = createScope(toolContext, firstKey), second = createScope(toolContext, secondKey);
        register(first.ctx, 'first_only'); register(second.ctx, 'second_only');
        const store = new MemoryStore();
        const catalog = new SemanticRegistry(store);
        catalog.refresh(['first_only', 'second_only'].map(id => ({ id, description: '', parameters: {}, output: {} })));
        await catalog.configure([{ id: 'first_only', path: 'first.read', pinned: false }, { id: 'second_only', path: 'second.read', pinned: false }], catalog.revision);
        const component = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, catalog), catalog, new ProfileSessions(catalog, store));
        const agent = { id: 'cached', ctx, session: Session.create(SessionId('cached')) } as Agent;
        const binding = bindScopeParent(agent, firstKey);
        const addition = await component.addition(agent);
        const pointer = addition.profile.pointer;
        assert.deepEqual((await component.entries(agent)).map(entry => entry.path), ['first.read']);
        binding.rebind(secondKey);
        assert.deepEqual((await component.entries(agent)).map(entry => entry.path), ['second.read']);
        assert.equal(addition.profile.pointer, pointer);
        await component.release(agent.id);
        assert.equal(await component.addition(agent), addition);
        await first.dispose(); await second.dispose();
    } finally { await ctx.fiber.dispose(); }
});
