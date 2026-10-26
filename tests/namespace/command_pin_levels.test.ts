import { createNamespace } from '../../src/namespace/namespace.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SemanticRegistry, type Mapping, type PinLevel } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { NamespaceComponent } from '../../src/namespace/component.js';
import { TreeProvider } from '../../src/management/panel/tree_provider.js';

const tool = {
    id: 'read_file', description: 'Read a file.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path.' } }, required: ['path'], additionalProperties: false },
    output: { type: 'object', properties: { content: { type: 'string', description: 'File contents.' } }, required: ['content'], additionalProperties: false },
};

/** @brief Render the real prompt assembly with an isolated Profile registry. */
function prompt(registry: SemanticRegistry): Promise<string> {
    const component = { registryFor: async () => registry, aliases: [], isPtc: () => true } as unknown as NamespaceComponent;
    return NamespaceComponent.prototype.prompt.call(component, {} as Agent);
}

test('three command levels hide, summarize, or publish complete documented signatures', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([tool, { id: 'tools_profile_load', description: 'Load Profile', parameters: {}, output: {} }]);
    for (const level of [0, 1, 2] as const) {
        const mapping: Mapping = { id: tool.id, path: 'files.read', pinned: false, alwaysVisible: level };
        await registry.configure([mapping], registry.snapshot().revision, undefined, undefined, undefined, undefined, { read_file: 'Custom brief' }, { 'tools.profile.load': level });
        const text = await prompt(registry);
        assert.equal(text.includes('namespace files'), level > 0);
        assert.equal(text.includes('const load:') || text.includes('function load('), level > 0);
        if (level === 1) {
            assert(text.includes('/** @brief Custom brief */'));
            assert(text.includes('const read: Function;'));
            assert(!text.includes('@param path'));
        }
        if (level === 2) {
            assert(text.includes('function read(path: string): Promise<string>;'));
            assert(text.includes('@brief Custom brief'));
            assert(!text.includes('Read a file.'));
            assert(text.includes('@param path File path.'));
            assert(!text.includes('@returns'));
            assert(!text.includes('File contents.'));
            assert(text.includes('function load(name?: string): Promise<Profile>;'));
        }
    }
});

test('detailed pins survive mount, unmount, profile save, and storage reload', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    registry.refresh([tool, { id: 'tools_profile_load', description: 'Load Profile', parameters: {}, output: {} }]);
    await registry.configure([], 0, undefined, undefined, { read_file: 2 }, undefined, undefined, { 'tools.search': 2 });
    await registry.configure([{ id: tool.id, path: 'files.read', pinned: false }], 1);
    assert.equal(registry.snapshot().mappings[0]?.alwaysVisible, 2);
    assert.deepEqual(registry.snapshot().unmountedVisible, {});
    await registry.configure([], 2);
    assert.equal(registry.snapshot().unmountedVisible?.read_file, 2);
    await registry.saveProfile('Detailed', registry.configuration());
    const restored = new SemanticRegistry(store);
    await restored.load(); restored.refresh([tool]);
    assert.equal(restored.configuration('Detailed').unmountedVisible.read_file, 2);
    assert.equal(restored.effective()[0]?.alwaysVisible, 2);
    assert.equal(restored.snapshot().builtinVisible?.['tools.search'], 2);
    await assert.rejects(restored.configure([{ id: tool.id, path: 'files.read', pinned: false, alwaysVisible: 3 as PinLevel }], 4), /Invalid mapping/);
});

test('builtin provider preserves detailed pins and keeps discovery pinned', () => {
    const tree = TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!, { 'tools.search': 2, 'tools.intellisense': 2 });
    assert.equal(tree.find(node => node.path === 'tools')?.commands.find(command => command.path === 'tools.search')?.alwaysVisible, 2);
    assert.equal(tree.find(node => node.path === 'tools')?.commands.find(command => command.path === 'tools.intellisense')?.alwaysVisible, 2);
    assert.equal(TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!, { 'tools.intellisense': 0 }).find(node => node.path === 'tools')?.commands.find(command => command.path === 'tools.intellisense')?.alwaysVisible, 2);
});

test('PTC initial prompts retain descriptions of parents of pinned commands only', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([tool, { id: 'tools_intellisense', description: 'Discover tools', parameters: {}, output: {} }]);
    for (const level of [0, 1, 2] as const) {
        await registry.configure([{ id: tool.id, path: 'files.library.read', pinned: false, alwaysVisible: level }], registry.snapshot().revision, [
            { path: 'files', description: 'File operations', alwaysVisible: false },
            { path: 'files.library', description: 'Library files', alwaysVisible: false },
        ]);
        const text = await prompt(registry);
        assert(text.includes('namespace tools {  // Tool discovery and Profile management'));
        assert.equal(text.includes('namespace files {  // File operations'), level > 0);
        assert.equal(text.includes('namespace library {  // Library files'), level > 0);
    }
});
