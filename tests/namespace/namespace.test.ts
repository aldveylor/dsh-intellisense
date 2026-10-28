import { positionalArguments } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { Aliases, manifest, resultFor, declaration } from '../../src/namespace/namespace.js';
import { nativeDiscovery } from '../../src/namespace/native_tools.js';
import { inspect } from '../../src/tools/inspect.js';

/** @brief Provide a scoped catalog with preserved native command documentation. */
async function registry(): Promise<SemanticRegistry> {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read_file', description: '读取文件（保留注释原文）', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: '文件路径' } }, additionalProperties: false }, output: { type: 'string' } }]);
    await registry.configure([{ id: 'read_file', path: 'files.read', pinned: false }], 0);
    return registry;
}

test('disabled tools paths are omitted while YAML path aliases validate native arguments on the host', async () => {
    const entries = manifest(await registry(), Aliases.parse([{ path: 'std.fs.read', tool: 'read_file' }]));
    assert(!entries.commands().some(entry => entry.path === 'tools' || entry.path.startsWith('tools.')));
    assert(manifest(await registry(), []).commands().some(entry => entry.path === 'files.read'));
    assert(!entries.commands().some(entry => entry.path.startsWith('unknown.')));
    const alias = entries.commands().find(entry => entry.path === 'std.fs.read')!;
    assert.deepEqual(await positionalArguments(alias, ['a']), { path: 'a' });
    await assert.rejects(positionalArguments(alias, [3]), /Invalid arguments/);
    assert.throws(() => Aliases.parse([{ path: 'console.read', tool: 'read_file' }]), /Reserved/);
});

test('reserved tools paths reject aliases while physical tools support custom paths', async () => {
    const catalog = await registry();
    catalog.refresh([...catalog.tools(), { id: 'tools_mount', description: 'Mount', parameters: { type: 'object' }, output: {} }]);
    const entries = manifest(catalog, Aliases.parse([{ path: 'custom.mount', tool: 'tools_mount' }]));
    assert.throws(() => Aliases.parse([{ path: 'tools.read', tool: 'read_file' }]), /Reserved alias path/);
    assert(entries.commands().some(entry => entry.path === 'custom.mount'));
    assert(!entries.commands().some(entry => entry.path === 'tools.mount'));
});

test('detailed completion uses valid TypeScript/Doxygen declarations and preserves namespace command comments', async () => {
    const entries = manifest(await registry(), Aliases.parse([{ path: 'std.fs.read', tool: 'read_file' }]));
    const text = declaration(entries.commands().find(entry => entry.path === 'std.fs.read')!);
    assert(text.includes('@brief 读取文件（保留注释原文）'));
    assert(!text.includes('@param args.path'));
    assert(text.includes('@param path 文件路径'));
    assert(text.includes('function read(path: string): Promise<string>'));
    const file = ts.createSourceFile('inspect.d.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(file.statements[0]?.kind, ts.SyntaxKind.ModuleDeclaration);
    assert.equal((file as typeof file & { parseDiagnostics: unknown[] }).parseDiagnostics.length, 0);
    const info = inspect(['std.fs.read'], entries, true);
    assert(info.includes('function read(path: string)'));
    assert(info.includes('@brief 读取文件（保留注释原文）'));
    const fixed = inspect(['console.log'], entries, true);
    assert(!fixed.includes('namespace console'));
    assert(!fixed.includes('function log('));
    assert(!inspect(['tools.mount'], entries, true).includes('function mount'));
    const root = inspect([''], entries, true);
    assert(root.includes('namespace tools'));
    assert(root.includes('namespace std'));
    assert(!inspect(['console.log'], entries, false).includes('function log('));
});

test('cwd and other single-field results expose scalar contracts and repack positional arguments', async () => {
    const entry = { path: 'std.cwd', tool: 'cwd', doc: 'Read &amp; change directory.', schema: { type: 'object', properties: { cd: { type: 'string' } } }, output: { type: 'object', properties: { cwd: { type: 'string' } }, required: ['cwd'] } };
    assert(declaration(entry).includes('function cwd(cd?: string): Promise<string>'));
    assert(declaration(entry).includes('Read & change directory.'));
    assert.deepEqual(await positionalArguments(entry, []), {});
    assert.deepEqual(await positionalArguments(entry, ['child']), { cd: 'child' });
    assert.equal(resultFor(entry, { cwd: '/work' }), '/work');
    await assert.rejects(positionalArguments(entry, [{ cd: 'child' }]), /Invalid arguments/);
    await assert.rejects(positionalArguments(entry, ['a', 'b']), /Invalid positional argument count/);
});

test('positional contracts handle required-first order, optional holes, nulls and structured fields', async () => {
    const entry = { path: 'std.edit', tool: 'edit', doc: 'Edit', schema: { type: 'object', additionalProperties: false,
        properties: { optional: { type: 'string' }, path: { type: 'string' }, options: { type: 'object', properties: { nested: { type: 'boolean' } }, additionalProperties: false }, nullable: { type: 'null' } }, required: ['path'] },
        output: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } }, required: ['a', 'b'] } };
    const signature = declaration(entry);
    assert(signature.includes('path: string, optional?: string,'));
    assert.deepEqual(await positionalArguments(entry, ['file', undefined, { nested: true }, null]), { path: 'file', options: { nested: true }, nullable: null });
    const result = { a: 1, b: 'b' };
    assert.deepEqual(resultFor(entry, result), result);
    await assert.rejects(positionalArguments(entry, []), /Invalid arguments/);
});

test('zero-argument closed objects and unstructured object inputs keep unambiguous contracts', async () => {
    const entry = { path: 'std.list', tool: 'list', doc: 'List', schema: { type: 'object', additionalProperties: false }, output: { type: 'string' } };
    assert(declaration(entry).includes('function list(): Promise<string>'));
    assert.deepEqual(await positionalArguments(entry, []), {});
    const open = { ...entry, schema: { type: 'object' } };
    assert.deepEqual(await positionalArguments(open, [{ key: 'value' }]), { key: 'value' });
    await assert.rejects(positionalArguments(open, [null]), /Invalid arguments/);
});

test('namespace descriptions survive native discovery and PTC member and exact queries', async () => {
    const catalog = await registry();
    await catalog.configure([{ id: 'read_file', path: 'files.library.read', pinned: false }], catalog.snapshot().revision, [
        { path: 'files', description: 'File operations', alwaysVisible: false },
        { path: 'files.library', description: 'Library files', alwaysVisible: false },
    ]);
    const root = manifest(catalog, []);
    const members = JSON.parse(nativeDiscovery(['', 'files.'], root)).members;
    assert.equal(members.find((member: { path: string }) => member.path === 'files').brief, 'File operations');
    assert.equal(members.find((member: { path: string }) => member.path === 'files.library').brief, 'Library files');
    assert.equal(members.find((member: { path: string }) => member.path === 'tools').brief, 'Tool discovery and Profile management');
    for (const query of ['files.library.', 'global.files.library.read']) {
        const text = inspect([query], root, true);
        assert(text.includes('namespace files {  // File operations'));
        assert(text.includes('namespace library {  // Library files'));
        assert(!text.includes('namespace tools'));
    }
    for (const query of ['', 'tools.', 'tools.profile.']) {
        assert(inspect([query], root, true).includes('namespace tools {  // Tool discovery and Profile management'));
    }
});


test('YAML path aliases reject removed argument mappings', () => {
    assert.equal(Aliases.safeParse([{ path: 'files.read', tool: 'read_file', argMap: { filename: 'path' } }]).success, false);
});
