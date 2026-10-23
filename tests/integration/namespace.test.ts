import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { Aliases, manifest, argumentsFor, resultFor, declaration } from '../../src/integration/namespace.js';
import { intellisense } from '../../src/integration/intellisense.js';
import { RuntimeHost } from '../../src/runtime/host.js';
import { SessionId } from '@deepseek-ai/dsh-session';

/** @brief Provide a scoped catalog with preserved native command documentation. */
function registry(): SemanticRegistry {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read_file', description: '读取文件（保留注释原文）', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: '文件路径' } }, additionalProperties: false }, output: { type: 'string' } }]);
    return registry;
}

test('disabled tools paths are omitted while YAML aliases validate mapped arguments on the host', () => {
    const entries = manifest(registry(), Aliases.parse([{ path: 'std.fs.read', tool: 'read_file', argMap: { filename: 'path' } }]));
    assert(!entries.some(entry => entry.path === 'tools' || entry.path.startsWith('tools.')));
    assert.deepEqual(manifest(registry(), []), []);
    assert(!entries.some(entry => entry.path.startsWith('unknown.')));
    const alias = entries.find(entry => entry.path === 'std.fs.read')!;
    assert.deepEqual(argumentsFor(alias, ['a']), { path: 'a' });
    assert.throws(() => argumentsFor(alias, [3]), /Invalid arguments/);
    assert.throws(() => manifest(registry(), Aliases.parse([{ path: 'console.read', tool: 'read_file' }])), /Reserved/);
});

test('tools management cannot be re-enabled through a custom YAML alias', () => {
    const catalog = registry();
    catalog.refresh([...catalog.tools(), { id: 'tools_mount', description: 'Mount', parameters: { type: 'object' }, output: {} }]);
    const entries = manifest(catalog, Aliases.parse([{ path: 'custom.mount', tool: 'tools_mount' }, { path: 'tools.read', tool: 'read_file' }]));
    assert.deepEqual(entries, []);
});

test('detailed completion uses valid TypeScript/Doxygen declarations and preserves namespace command comments', async () => {
    const entries = manifest(registry(), Aliases.parse([{ path: 'std.fs.read', tool: 'read_file' }]));
    const text = declaration(entries.find(entry => entry.path === 'std.fs.read')!);
    assert(text.includes('@brief 读取文件（保留注释原文）'));
    assert(!text.includes('@param args.path'));
    assert(text.includes('/** 文件路径 */'));
    assert(text.includes('function read(/** 文件路径 */ path: string): Promise<string>'));
    const file = ts.createSourceFile('intellisense.d.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(file.statements[0]?.kind, ts.SyntaxKind.ModuleDeclaration);
    assert.equal((file as typeof file & { parseDiagnostics: unknown[] }).parseDiagnostics.length, 0);
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const query = { prefix: 'await std.fs.read(', context: '', sessionId: SessionId('sense'), signal: new AbortController().signal };
        const info = await intellisense(query, entries, host);
        assert.equal(info.kind, 'signature'); assert.equal(info.text, text);
        const fixed = await intellisense({ ...query, prefix: 'console.log' }, entries, host);
        assert(fixed.text.includes('namespace console'));
        assert(fixed.text.includes('function log('));
        const disabled = await intellisense({ ...query, prefix: 'tools.mount' }, entries, host);
        assert(disabled.text.includes('temporarily disabled'));
        assert(!disabled.text.includes('function mount'));
        const root = await intellisense({ ...query, prefix: '' }, entries, host);
        assert(!root.text.includes('tools.'));
    } finally { await host.dispose(); }
});

test('cwd and other single-field results expose scalar contracts and repack positional arguments', () => {
    const entry = { path: 'std.cwd', tool: 'cwd', doc: 'Read &amp; change directory.', schema: { type: 'object', properties: { cd: { type: 'string' } } }, output: { type: 'object', properties: { cwd: { type: 'string' } }, required: ['cwd'] } };
    assert(declaration(entry).includes('function cwd(cd?: string): Promise<string>'));
    assert(declaration(entry).includes('Read & change directory.'));
    assert.deepEqual(argumentsFor(entry, []), {});
    assert.deepEqual(argumentsFor(entry, ['child']), { cd: 'child' });
    assert.equal(resultFor(entry, { cwd: '/work' }), '/work');
    assert.throws(() => argumentsFor(entry, [{ cd: 'child' }]), /Invalid arguments/);
    assert.throws(() => argumentsFor(entry, ['a', 'b']), /Too many/);
});

test('positional contracts handle required-first order, aliases, optional holes, nulls and structured fields', () => {
    const entry = { path: 'std.edit', tool: 'edit', doc: 'Edit', argMap: { filename: 'path' }, schema: { type: 'object', additionalProperties: false,
        properties: { optional: { type: 'string' }, path: { type: 'string' }, options: { type: 'object', properties: { nested: { type: 'boolean' } }, additionalProperties: false }, nullable: { type: 'null' } }, required: ['path'] },
        output: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } }, required: ['a', 'b'] } };
    const signature = declaration(entry);
    assert(signature.includes('filename: string, optional?: string,'));
    assert.deepEqual(argumentsFor(entry, ['file', undefined, { nested: true }, null]), { path: 'file', options: { nested: true }, nullable: null });
    const result = { a: 1, b: 'b' };
    assert.deepEqual(resultFor(entry, result), result);
    assert.throws(() => argumentsFor(entry, []), /Invalid arguments/);
});

test('zero-argument closed objects and unstructured object inputs keep unambiguous contracts', () => {
    const entry = { path: 'std.list', tool: 'list', doc: 'List', schema: { type: 'object', additionalProperties: false }, output: { type: 'string' } };
    assert(declaration(entry).includes('function list(): Promise<string>'));
    assert.deepEqual(argumentsFor(entry, []), {});
    const open = { ...entry, schema: { type: 'object' } };
    assert.deepEqual(argumentsFor(open, [{ key: 'value' }]), { key: 'value' });
});
