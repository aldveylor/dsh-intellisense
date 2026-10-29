import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pluginCommands, projectBuiltin, type BuiltinTool } from '../../src/runtime/builtins.js';
import { createNamespace } from '../namespace/fixtures.js';

test('builtin projection resolves each comment while preserving execution metadata and its source', () => {
    const source: BuiltinTool = { tool: 'example', path: 'tools.example', signature: '(name: string) => Promise<void>',
        description: { native: 'Named arguments.', ptc: 'Positional arguments.' },
        parameterDocs: { name: { native: 'Native name.', ptc: 'PTC name.' }, common: 'Shared comment.' },
        discoveryHint: { native: 'Native discovery.', ptc: 'PTC discovery.' }, discardResult: true, positional: [['name']] };
    for (const mode of ['native', 'ptc'] as const) {
        const projected = projectBuiltin(source, mode);
        assert.equal(projected.description, mode === 'native' ? 'Named arguments.' : 'Positional arguments.');
        assert.equal(projected.parameterDocs?.name, mode === 'native' ? 'Native name.' : 'PTC name.');
        assert.equal(projected.parameterDocs?.common, 'Shared comment.');
        assert.equal(projected.discoveryHint, mode === 'native' ? 'Native discovery.' : 'PTC discovery.');
        assert.equal(projected.discardResult, true);
        assert.deepEqual(projected.positional, [['name']]);
        projected.parameterDocs = {};
    }
    assert.deepEqual(source.parameterDocs?.name, { native: 'Native name.', ptc: 'PTC name.' });
});

test('namespace builtin descriptions and declarations use the selected execution mode', () => {
    for (const mode of ['native', 'ptc'] as const) {
        const root = createNamespace({ tools: [], includeUnavailable: true, mode });
        const discovery = root.entries.find(entry => entry.path === 'tools.inspect')!;
        const annotation = root.entries.find(entry => entry.path === 'tools.profile.annotation')!;
        const profiles = root.entries.find(entry => entry.path === 'tools.profile.profiles')!;
        const contract = projectBuiltin(pluginCommands.discoveryCommand, mode);
        assert.equal(discovery.doc, contract.description);
        assert.equal(discovery.serialize().description, contract.description);
        assert(discovery.declaration().includes(contract.parameterDocs!.queries!));
        assert.equal(discovery.doc.includes('TypeScript'), mode === 'ptc');
        assert.equal(discovery.doc.includes('{"queries":[""]}'), mode === 'native');
        assert.equal(annotation.doc.includes('JSON Schema'), mode === 'native');
        assert.equal(profiles.doc.includes('read-only'), mode === 'ptc');
    }
});
