import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { argumentsFor, nativeArgumentsFor, nativeSchema, type ManifestEntry } from '../../src/integration/namespace.js';
import { intellisense, registerIntellisense } from '../../src/integration/intellisense.js';
import type { NamespaceComponent } from '../../src/integration/namespace_component.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from '../../src/integration/native_tools.js';

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
    const execution = {} as ToolRunContext;
    await assert.rejects(definition.execute({ queries: ['std.'] }, execution), /A live conversation is required/);
    await assert.rejects(definition.execute([3], execution), /invalid arguments/i);
    await assert.rejects(definition.execute(['std.'], execution), /invalid arguments/i);
});

test('native discovery keeps queries while PTC repacks an unwrapped string array', () => {
    const schema = { type: 'array', items: { type: 'string' }, description: 'Query paths' };
    const entry: ManifestEntry = { path: 'tools.intellisense', tool: 'tools_intellisense', doc: 'Discover',
        schema: { type: 'object', properties: { queries: schema }, required: ['queries'] }, output: { type: 'string' } };
    const queries = ['global.std.', 'std.cwd'];
    assert.deepEqual(nativeSchema(entry), entry.schema);
    assert.deepEqual(nativeArgumentsFor(entry, { queries }), { queries });
    assert.deepEqual(argumentsFor(entry, [queries]), { queries });
    assert.deepEqual(argumentsFor(entry, [[]]), { queries: [] });
    assert.throws(() => nativeArgumentsFor(entry, queries), /invalid arguments/i);
    assert.throws(() => argumentsFor(entry, [[3]]), /invalid arguments/i);
});

test('global prefix preserves native selection, namespace listings and exact contracts', () => {
    const bindings = nativeBindings(entries, []);
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read']) {
        assert.deepEqual(nativeQueryEntries(['global.' + query], entries), nativeQueryEntries([query], entries));
        assert.equal(nativeDiscovery(['global.' + query], bindings), nativeDiscovery([query], bindings));
    }
    const exact = JSON.parse(nativeDiscovery(['global.std.fs.read'], bindings));
    assert.deepEqual(exact.members[0].parameters, entries[1]!.schema);
    assert.throws(() => nativeDiscovery(['global.std..'], bindings), /Invalid IntelliSense query/);
});

test('global prefix preserves PTC declarations including runtime values and builtins', () => {
    for (const query of ['', 'std.', 'std.cwd', 'std.fs.', 'std.fs.read', 'tools.profile.annotation', 'console.log']) {
        assert.equal(intellisense(['global.' + query], entries, true), intellisense([query], entries, true));
    }
    assert.throws(() => intellisense(['global.std..'], entries, true), /Invalid IntelliSense query/);
});
