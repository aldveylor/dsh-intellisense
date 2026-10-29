import { namespace, positionalArguments, profileFixture } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeArgumentsFor, type ManifestEntry } from '../../src/profile/namespace/namespace.js';
import { callableDeclaration, executionInstructions } from '../../src/profile/namespace/prompt.js';
import { pluginCommands, projectBuiltin } from '../../src/runtime/builtins.js';
import { declaration } from '../../src/profile/namespace/namespace.js';
import { registerInspect } from '../../src/tools/inspect.js';
import { inspect } from '../namespace/fixtures.js';
import type { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableFunction } from '../../src/profile/function.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { nativeDiscovery, nativeQueryEntries } from '../namespace/fixtures.js';

const entries: ManifestEntry[] = [
    { path: 'std.cwd', tool: 'cwd', doc: 'Current directory', schema: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'string' } },
    { path: 'std.fs.read', tool: 'read', doc: 'Read file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, output: { type: 'string' } },
];

test('registered physical discovery tool exposes and validates the queries object contract', async () => {
    let definition!: ToolDefinition;
    const ctx = { effect: (callback: () => unknown) => callback(), tools: {
        register: (tool: ToolDefinition) => { definition = tool; return () => {}; },
    } } as unknown as Context;
    registerInspect(ctx, {} as NamespaceIntegration);
    assert.equal(definition.parameters.type, 'object');
    assert.deepEqual(definition.parameters.required, ['queries']);
    assert(definition.description.includes('{"queries":[""]}'));
    assert.match(executionInstructions('native'), /native DSML tools with named arguments/);
    assert.match(executionInstructions('native'), /ns_tools__inspect/);
    const execution = {} as ToolRunContext;
    await assert.rejects(definition.execute({ queries: ['std.'] }, execution), /A live conversation is required/);
    await assert.rejects(definition.execute([3], execution), /invalid arguments/i);
    await assert.rejects(definition.execute(['std.'], execution), /invalid arguments/i);
});

test('native and PTC discovery preserve a single query array', async () => {
    const schema = { type: 'array', items: { type: 'string' }, description: 'Query paths' };
    const entry: ManifestEntry = { path: 'tools.inspect', tool: 'tools_inspect', doc: 'Discover',
        schema: { type: 'object', properties: { queries: schema }, required: ['queries'] }, output: { type: 'string' } };
    const queries = ['global.std.', 'std.cwd'];
    for (const source of [declaration(namespace([entry]).commands().find(node => node.tool === entry.tool)!), callableDeclaration(projectBuiltin(pluginCommands.discoveryCommand, 'ptc')), inspect(['tools.inspect'], namespace([entry]), true)]) {
        assert.match(source, /function inspect\(queries: string\[\]\): Promise<string>/);
        assert(source.includes('tools.inspect([""])'));
    }
    assert.match(executionInstructions('ptc'), /tools_run_code/);
    assert.match(executionInstructions('ptc'), /globalThis/);
    assert.deepEqual(JSON.parse(nativeDiscovery(['tools.inspect'], namespace([entry]))).members[0].parameters, entry.schema);
    assert.deepEqual(nativeArgumentsFor(entry, { queries }), { queries });
    assert.deepEqual(await positionalArguments(entry, [queries]), { queries });
    assert.deepEqual(await positionalArguments(entry, [[]]), { queries: [] });
    assert.deepEqual(await positionalArguments(entry, [['']]), { queries: [''] });
    await assert.rejects(positionalArguments(entry, queries), /Invalid positional argument count/);
    await assert.rejects(positionalArguments(entry, []), /invalid arguments/i);
    await assert.rejects(positionalArguments(entry, ["std."]), /invalid arguments/i);
    assert.throws(() => nativeArgumentsFor(entry, queries), /invalid arguments/i);
    await assert.rejects(positionalArguments(entry, [3]), /invalid arguments/i);
});

test('global prefix preserves native selection, namespace listings and exact contracts', async () => {
    const root = namespace(entries);
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read']) {
        assert.deepEqual(nativeQueryEntries(['global.' + query], root), nativeQueryEntries([query], root));
        assert.equal(nativeDiscovery(['global.' + query], root), nativeDiscovery([query], root));
    }
    const exact = JSON.parse(nativeDiscovery(['global.std.fs.read'], root));
    assert.deepEqual(exact.members[0].parameters, entries[1]!.schema);
    assert.throws(() => nativeDiscovery(['global.std..'], root), /Invalid Inspect query/);
});

test('global prefix preserves PTC declarations including runtime values and builtins', async () => {
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read', 'tools.profile.annotation', 'console.log']) {
        assert.equal(inspect(['global.' + query], namespace(entries), true), inspect([query], namespace(entries), true));
    }
    assert.throws(() => inspect(['global.std..'], namespace(entries), true), /Invalid Inspect query/);
});

test('PTC declarations omit explicitly disabled namespaces and their descendants', () => {
    const profile = new EditableSnapshot();
    const hidden = profile.create('hidden', () => new EditableNamespace()).setDescription('Hidden namespace').setDisabled(true);
    hidden.create('nested', () => new EditableNamespace());
    profile.create('visible', () => new EditableNamespace()).setDescription('Visible namespace');
    const root = profileFixture(profile, []);
    for (const query of ['hidden', 'hidden.', 'hidden.nested', 'hidden.nested.', 'global.hidden.']) {
        assert.equal(inspect([query], root, true), inspect([], root, true));
    }
    const listing = inspect(['', 'hidden.', 'visible.'], root, true);
    assert(!listing.includes('hidden'));
    assert(listing.includes('namespace visible'));
});


test('inspection reads session nodes and summaries without registry mounts or aliases', () => {
    const profile = new EditableSnapshot();
    const files = profile.create('session_files', () => new EditableNamespace()).setDescription('Session namespace');
    files.create('read', () => new EditableFunction()).setTool('read').setDescription('Session summary');
    files.create('disabled', () => new EditableFunction()).setTool('read').setDisabled(true);
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Physical documentation', parameters: { path: { type: 'string', required: true } }, output: { type: 'string' } }]);
    const root = profileFixture(profile, registry.tools(), 'ptc', registry.toolAdditions);
    const listing = inspect(['session_files.'], root, true);
    assert.match(listing, /Session namespace/);
    assert.match(listing, /Session summary/);
    assert.doesNotMatch(listing, /disabled/);
    assert.match(inspect(['session_files.read'], root, true), /Physical documentation/);
    const native = JSON.parse(nativeDiscovery(['session_files.read'], root));
    assert.equal(native.members[0].brief, 'Session summary');
    assert.equal(native.members[0].description, 'Physical documentation');
    assert.equal(native.members[0].parameters.path.type, 'string');
    assert.deepEqual(JSON.parse(nativeDiscovery(['read'], root)).members, []);
    files.setDisabled(true);
    const disabled = profileFixture(profile, registry.tools(), 'native', registry.toolAdditions);
    assert.deepEqual(JSON.parse(nativeDiscovery(['session_files.read'], disabled)).members, []);
});
