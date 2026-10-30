import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { EditableFunction } from '../../src/profile/function.js';
import { RootNamespace } from '../../src/tools/profile_nodes/root_namespace.js';
import { manifest, promptFor, inspect, nativeDiscovery } from './fixtures.js';

const documentation = 'Read file contents.\nSupports text and binary files.';

test('absent and blank summaries preserve full agent documentation without inventing a summary', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: documentation, parameters: {}, output: {} }]);
    for (const description of [undefined, '', ' \n ', 'Read content.']) {
        const command = new EditableFunction('', { type: 'function', function: { tool: 'read', doc: description } });
        assert.equal(command.serialize().function.doc, description?.trim() ? description : undefined);
        command.setDescription('Custom summary.').setDescription(description);
        assert.equal(command.copyNode(command.serialize()).serialize().function.doc, description?.trim() ? description : undefined);
        await registry.configure([{ id: 'read', path: 'files.read', pinned: false, alwaysVisible: 1, description }], registry.snapshot().revision);
        for (const mode of ['native', 'ptc'] as const) {
            const fixture = manifest(registry, [], mode);
            const text = await promptFor(registry, mode);
            const expected = description?.trim() ? description : documentation;
            for (const line of expected.split('\n')) assert(text.includes(line));
            const discovery = JSON.parse(nativeDiscovery(['files.'], fixture));
            assert(JSON.stringify(discovery).includes(JSON.stringify(expected).slice(1, -1)));
            const declarations = inspect(['files.'], fixture, true);
            for (const line of expected.split('\n')) assert(declarations.includes(line));
            const node = fixture.serialize().children!.find(node => node.name === 'files')!.children![0]!;
            assert.equal(node.description, description?.trim() ? description : undefined);
            assert.equal(node.function!.doc, documentation);
        }
    }
});

test('discovery and search have no Profile summary, including after snapshot hydration', () => {
    const root = new RootNamespace();
    const restored = root.clone({ root: root.serialize() });
    for (const profile of [root, restored]) {
        for (const path of ['tools.inspect', 'tools.search']) {
            const node = profile.resolve(path) as EditableFunction;
            assert.equal(node.serialize().function.doc, undefined);
            assert.equal(node.permissions.commentable, false);
        }
    }
});
