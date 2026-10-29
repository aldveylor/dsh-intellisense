import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { pluginCommands } from '../../src/runtime/builtins.js';
import { MemoryStore } from '../../src/storage/store.js';

test('preloads skip disabled producers and honor subtree disables', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh(pluginCommands.builtinTools.map(command => ({ id: command.tool, description: '', parameters: {}, output: {} })));
    let commands = 0;
    let profiles = 0;
    const component = Object.assign(Object.create(NamespaceIntegration.prototype), {
        namespace: { registry },
        commandBriefs: async () => { commands++; return []; },
        profileNames: async () => { profiles++; return { profiles: ['Default'], selected: 'Default' }; },
    }) as NamespaceIntegration;
    await registry.configure([], registry.revision, [], [], {}, undefined, {}, {}, {}, undefined, false, ['tools.profile.commands']);
    const values = await component.values();
    assert.equal(commands, 0);
    assert.equal(profiles, 1);
    assert.equal(Object.hasOwn(values, 'tools.profile.annotation'), true);
    assert.equal(Object.hasOwn(values, 'tools.profile.commands'), false);
    await registry.configure([], registry.revision, [], [], {}, undefined, {}, {}, {}, undefined, false, []);
    await component.values();
    assert.equal(commands, 1);
    await registry.configure([], registry.revision, [], [], {}, undefined, {}, {}, {}, undefined, false, ['tools.profile']);
    assert.deepEqual(await component.values(), {});
    assert.equal(commands, 1);
    assert.equal(profiles, 2);
});
