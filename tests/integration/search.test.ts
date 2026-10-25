import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { manifest, argumentsFor, declaration } from '../../src/integration/namespace.js';
import { createSearchEngines, accurateEngine } from '../../src/search/search.js';
import { SearchEngineRegistry } from '../../src/search/engine_registry.js';
import { searchDefinition, registerSearch } from '../../src/integration/tool_search.js';
import { intellisense } from '../../src/integration/intellisense.js';
import { TreeProvider } from '../../src/management/panel/tree_provider.js';
import { profileTree, profileConfiguration } from '../../src/registry/profile_tree.js';

/** @brief Provide real Profile and manifest behavior without starting an agent or worker. */
async function fixture(searchEngines = createSearchEngines()) {
    const registry = new SemanticRegistry(new MemoryStore());
    const physical = { id: 'read', description: 'Read documents', parameters: { type: 'object', properties: { path: { type: 'string' } } }, output: { type: 'string' } };
    registry.refresh([physical]);
    await registry.configure([{ id: 'read', path: 'files.read', aliases: [], pinned: false }], 0);
    const namespaces = { searchEngines, registryFor: async () => registry, entries: async () => manifest(registry, []) };
    const definition = searchDefinition(namespaces);
    registry.refresh([physical, { id: definition.name, description: definition.description, parameters: definition.parameters, output: definition.output.schema }]);
    const execution = { agent: { id: 'search', session: Session.create(SessionId('search')) }, callId: 'search-call', signal: new AbortController().signal } as unknown as ToolRunContext;
    return { registry, namespaces, definition, execution };
}

test('search supports native arguments and PTC positions and stays unpinned by default', async () => {
    const { registry, definition, execution } = await fixture();
    const entry = manifest(registry, []).find(entry => entry.tool === 'tools_search')!;
    const args = argumentsFor(entry, [['documents'], 'accurate', 10, 'description', 'files']);
    assert.deepEqual(args, { keywords: ['documents'], method: 'accurate', max_results: 10, target: 'description', namespace_path: 'files' });
    assert.deepEqual(await definition.execute(args, execution), ['files.read']);
    assert(declaration(entry).includes('"bm25" | "accurate"'));
    assert.equal(TreeProvider()[0]!.commands.find(command => command.path === 'tools.search')!.alwaysVisible, 0);
    const config = registry.configuration();
    await registry.replaceConfiguration({ ...config, builtinVisible: { 'tools.search': 2 } }, 'Default');
    assert.equal(registry.snapshot().builtinVisible!['tools.search'], 2);
});

test('single-engine fallback removes method from schemas, declarations and positional layouts', async () => {
    const searchEngines = new SearchEngineRegistry();
    searchEngines.register(accurateEngine);
    const { registry, definition, execution } = await fixture(searchEngines);
    assert(!Object.hasOwn(definition.parameters.properties!, 'method'));
    const entry = manifest(registry, []).find(entry => entry.tool === 'tools_search')!;
    assert(!declaration(entry).includes('method?'));
    const args = argumentsFor(entry, [['documents'], 10, 'description', 'files']);
    assert.deepEqual(await definition.execute(args, execution), ['files.read']);
});

test('registry changes refresh scoped schemas and cleanup removes subscriptions', async () => {
    const { namespaces } = await fixture();
    let current: ToolDefinition | undefined;
    let cleanup: (() => void) | undefined;
    let notifications = 0;
    const ctx = { effect: (work: () => (() => void)) => { cleanup = work(); }, emit: () => { notifications++; }, tools: { register: (definition: ToolDefinition) => { current = definition; return () => { current = undefined; }; } } } as unknown as Context;
    registerSearch(ctx, namespaces as Parameters<typeof registerSearch>[1]);
    const remove = namespaces.searchEngines.register({ name: 'custom', description: 'External search', search: () => [] });
    namespaces.searchEngines.setDefault('custom');
    assert.equal((current!.parameters.properties!.method as { default: string }).default, 'custom');
    assert.equal(notifications, 2);
    cleanup!(); remove();
    assert.equal(current, undefined);
    assert.equal(notifications, 2);
});

test('disabled subtrees and commands stay saved but disappear from search and discovery', async () => {
    const { registry, definition, execution } = await fixture();
    const config = registry.configuration();
    await registry.replaceConfiguration({ ...config, namespaces: [{ path: 'files', description: '', alwaysVisible: true, disabled: true }] }, 'Default');
    assert.deepEqual(await definition.execute({ keywords: ['documents'], method: 'accurate' }, execution), []);
    assert(!manifest(registry, []).some(entry => entry.path === 'files.read'));
    const tree = profileTree('Default', registry.configuration());
    const restored = profileConfiguration(tree, config, [{ name: 'read', brief: 'Read documents' }]);
    assert.equal(restored.namespaces[0]!.disabled, true);
    await registry.replaceConfiguration({ ...config, mappings: config.mappings.map(mapping => ({ ...mapping, disabled: true })) }, 'Default');
    assert(!manifest(registry, [{ path: 'other.read', tool: 'read' }]).some(entry => entry.tool === 'read'));
    await registry.replaceConfiguration({ ...config, builtinDisabled: ['tools.search'] }, 'Default');
    assert(!manifest(registry, []).some(entry => entry.path === 'tools.search'));
    assert(!intellisense(['tools.'], manifest(registry, []), true, path => registry.disabled(path)).includes('const search'));
    await assert.rejects(definition.execute({ keywords: ['documents'] }, execution), /Execution denied/);
});
