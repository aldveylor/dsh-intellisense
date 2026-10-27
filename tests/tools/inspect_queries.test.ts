import { namespace, positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeArgumentsFor, type ManifestEntry } from '../../src/namespace/namespace.js';
import { builtinDeclaration, executionInstructions } from '../../src/namespace/prompt.js';
import { pluginCommands } from '../../src/runtime/builtins.js';
import { NamespaceNode, declaration } from '../../src/namespace/namespace.js';
import { inspect, registerInspect } from '../../src/tools/inspect.js';
import type { NamespaceComponent } from '../../src/namespace/component.js';
import { nativeDiscovery, nativeQueryEntries } from '../../src/namespace/native_tools.js';

const entries: ManifestEntry[] = [
    { path: 'std.cwd', tool: 'cwd', doc: 'Current directory', schema: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'string' } },
    { path: 'std.fs.read', tool: 'read', doc: 'Read file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, output: { type: 'string' } },
];

test('registered physical discovery tool exposes and validates the queries object contract', async () => {
    let definition!: ToolDefinition;
    const ctx = { effect: (callback: () => unknown) => callback(), tools: {
        register: (tool: ToolDefinition) => { definition = tool; return () => {}; },
    } } as unknown as Context;
    registerInspect(ctx, {} as NamespaceComponent);
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
    for (const source of [declaration(namespace([entry]).commands().find(node => node.tool === entry.tool)!), builtinDeclaration(pluginCommands.discoveryCommand), inspect(['tools.inspect'], namespace([entry]), true)]) {
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
    await assert.rejects(positionalArguments(entry, queries), /too many arguments/i);
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
    const root = new NamespaceNode('');
    const hidden = root.add(new NamespaceNode('hidden', root, 'Hidden namespace', undefined, true));
    hidden.add(new NamespaceNode('nested', hidden));
    root.add(new NamespaceNode('visible', root, 'Visible namespace'));
    for (const query of ['hidden', 'hidden.', 'hidden.nested', 'hidden.nested.', 'global.hidden.']) {
        assert.equal(inspect([query], root, true), inspect([], root, true));
    }
    const listing = inspect(['', 'hidden.', 'visible.'], root, true);
    assert(!listing.includes('hidden'));
    assert(listing.includes('namespace visible'));
});
