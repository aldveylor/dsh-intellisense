import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { Aliases, manifest, argumentsFor, declaration } from '../../src/integration/namespace.js';
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
    assert.deepEqual(argumentsFor(alias, { filename: 'a' }), { path: 'a' });
    assert.throws(() => argumentsFor(alias, { filename: 3 }), /Invalid arguments/);
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
    assert(text.includes('function read(/** Tool arguments */ args: read_args): Promise<string>'));
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
