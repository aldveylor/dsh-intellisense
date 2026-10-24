import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeBindings } from '../../src/integration/native_tools.js';
import { NamespaceComponent } from '../../src/integration/namespace_component.js';
import type { ManifestEntry } from '../../src/integration/namespace.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

test('native names satisfy API limits and avoid path and physical name collisions', () => {
    const paths = ['std.cwd', 'std__cwd', 'std.$cwd', 'std._24_cwd', 'std.' + 'a'.repeat(100)];
    const entries = paths.map(path => ({ path }) as ManifestEntry);
    const reserved = ['ns_std__cwd', 'ns_std__cwd_1'];
    const names = nativeBindings(entries, reserved).map(binding => binding.name);
    assert.equal(new Set(names).size, paths.length);
    assert.equal(names[0], 'ns_std__cwd_2');
    for (const name of names) {
        assert.match(name, /^ns_[a-zA-Z0-9_-]{1,61}$/);
        assert(!reserved.includes(name));
    }
    assert.deepEqual(nativeBindings(entries, reserved).map(binding => binding.name), names);
});

test('native aliases publish callable names, map arguments and revoke stale handlers', async () => {
    const definitions = new Map<string, ToolDefinition>();
    const ctx = { effect: () => {}, on: () => {}, emit: () => {}, tools: {
        register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => { definitions.delete(tool.name); }; },
    } } as unknown as Context;
    const store = new MemoryStore(), registry = new SemanticRegistry(store);
    const physical = [{ id: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }, output: { type: 'string' } }];
    registry.refresh(physical);
    await registry.configure([{ id: 'read_file', path: 'fs.read', aliases: [], enabled: true, pinned: false }], 0);
    const component = new NamespaceComponent(ctx, registry, new ProfileSessions(registry, store), [{ path: 'fs.open', tool: 'read_file', argMap: { path: 'file' } }]);
    component.physical = () => physical;
    const agent = { id: 'native-test', ctx } as Agent;
    assert.deepEqual(await component.syncNative(agent), []);
    const discovery = JSON.parse(await component.discover(agent, ['fs.']));
    assert.deepEqual(discovery.members.map((item: { path: string }) => item.path).sort(), ['fs.open', 'fs.read']);
    const names = await component.syncNative(agent);
    assert.deepEqual(names, ['ns_fs__read', 'ns_fs__open']);
    assert.deepEqual(await component.syncNative(agent), names);
    assert.equal(definitions.size, 2);
    const prompt = await component.prompt(agent);
    assert.equal(prompt, '');
    const open = definitions.get('ns_fs__open')!;
    assert.deepEqual(open.parameters, { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] });
    component.dispatch = async (_agent, entry, args) => ({ tool: entry.tool, args });
    const parent = { agent } as ToolRunContext;
    assert.deepEqual(await open.execute({ path: '/tmp/file' }, parent), { tool: 'read_file', args: { file: '/tmp/file' } });
    physical.length = 0;
    assert.deepEqual(await component.syncNative(agent), []);
    assert.equal(definitions.size, 0);
    await assert.rejects(async () => open.execute({ path: '/tmp/file' }, parent), /Execution denied/);
    await component.release(agent.id);
});
