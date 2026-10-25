import { namespace, positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { nativeArgumentsFor, nativeSchema, type ManifestEntry } from '../../src/namespace/namespace.js';
import { builtinDeclaration, executionInstructions } from '../../src/namespace/prompt.js';
import { pluginCommands } from '../../src/runtime/builtins.js';
import { declaration } from '../../src/namespace/namespace.js';
import { intellisense, registerIntellisense } from '../../src/tools/intellisense.js';
import type { NamespaceComponent } from '../../src/namespace/component.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from '../../src/namespace/native_tools.js';

const entries: ManifestEntry[] = [
    { path: 'std.cwd', tool: 'cwd', doc: 'Current directory', schema: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'string' } },
    { path: 'std.fs.read', tool: 'read', doc: 'Read file', schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, output: { type: 'string' } },
];

test('registered physical discovery tool exposes and validates the queries object contract', async () => {
    let definition!: ToolDefinition;
    const ctx = { effect: (callback: () => unknown) => callback(), tools: {
        register: (tool: ToolDefinition) => { definition = tool; return () => {}; },
    } } as unknown as Context;
    registerIntellisense(ctx, {} as NamespaceComponent);
    assert.equal(definition.parameters.type, 'object');
    assert.deepEqual(definition.parameters.required, ['queries']);
    assert(definition.description.includes('{"queries":[""]}'));
    assert(executionInstructions('native').includes('{"queries":[""]}'));
    const execution = {} as ToolRunContext;
    await assert.rejects(definition.execute({ queries: ['std.'] }, execution), /A live conversation is required/);
    await assert.rejects(definition.execute([3], execution), /invalid arguments/i);
    await assert.rejects(definition.execute(['std.'], execution), /invalid arguments/i);
});

test('native discovery keeps queries while PTC repacks variadic strings', async () => {
    const schema = { type: 'array', items: { type: 'string' }, description: 'Query paths' };
    const entry: ManifestEntry = { path: 'tools.intellisense', tool: 'tools_intellisense', doc: 'Discover',
        schema: { type: 'object', properties: { queries: schema }, required: ['queries'] }, output: { type: 'string' } };
    const queries = ['global.std.', 'std.cwd'];
    for (const source of [declaration(namespace([entry]).commands().find(node => node.tool === entry.tool)!), builtinDeclaration(pluginCommands.discoveryCommand), intellisense(['tools.intellisense'], namespace([entry]), true)]) {
        assert.match(source, /function intellisense\(\.\.\.args: string\[\]\): Promise<string>/);
        assert(source.includes('tools.intellisense("")'));
    }
    assert(executionInstructions('ptc').includes('tools.intellisense("")'));
    assert.deepEqual(nativeSchema(entry), entry.schema);
    assert.deepEqual(nativeArgumentsFor(entry, { queries }), { queries });
    assert.deepEqual(await positionalArguments(entry, queries), { queries });
    assert.deepEqual(await positionalArguments(entry, []), { queries: [] });
    assert.deepEqual(await positionalArguments(entry, ['']), { queries: [''] });
    await assert.rejects(positionalArguments(entry, [queries]), /invalid arguments/i);
    assert.throws(() => nativeArgumentsFor(entry, queries), /invalid arguments/i);
    await assert.rejects(positionalArguments(entry, [3]), /invalid arguments/i);
});

test('global prefix preserves native selection, namespace listings and exact contracts', async () => {
    const root = namespace(entries);
    const bindings = nativeBindings(root.commands().filter(node => node.deployment === 'tool'), []);
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read']) {
        assert.deepEqual(nativeQueryEntries(['global.' + query], root), nativeQueryEntries([query], root));
        assert.equal(nativeDiscovery(['global.' + query], root, bindings), nativeDiscovery([query], root, bindings));
    }
    const exact = JSON.parse(nativeDiscovery(['global.std.fs.read'], root, bindings));
    assert.deepEqual(exact.members[0].parameters, entries[1]!.schema);
    assert.throws(() => nativeDiscovery(['global.std..'], root, bindings), /Invalid IntelliSense query/);
});

test('global prefix preserves PTC declarations including runtime values and builtins', async () => {
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read', 'tools.profile.annotation', 'console.log']) {
        assert.equal(intellisense(['global.' + query], namespace(entries), true), intellisense([query], namespace(entries), true));
    }
    assert.throws(() => intellisense(['global.std..'], namespace(entries), true), /Invalid IntelliSense query/);
});
