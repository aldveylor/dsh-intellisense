import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import { EditableFunction } from '../../src/profile/function.js';
import { NamespaceDefinitions } from '../../src/profile/namespace/definitions.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';

/** @brief Build a protected identity while counting initial Profile construction. */
function factory(tool: string, created: () => void) {
    return () => {
        created();
        const profile = new EditableSnapshot();
        profile.create('command', () => new EditableFunction()).setTool(tool).setPermissions({ removable: false });
        return profile;
    };
}

test('registry reuses protected identities and refreshes them after factory replacement', () => {
    const definitions = new NamespaceDefinitions();
    let creations = 0;
    definitions.createInitialProfile = factory('first', () => { creations++; });
    const registry = new SemanticRegistry(new MemoryStore(), 'global', definitions);
    for (let i = 0; i < 100; i++) {
        assert.equal(registry.owns('first'), true);
        assert.equal(registry.owns('other'), false);
    }
    assert.equal(creations, 1);
    definitions.createInitialProfile = factory('second', () => { creations++; });
    assert.equal(registry.owns('first'), false);
    assert.equal(registry.owns('second'), true);
    assert.equal(creations, 2);
});

test('integration shares one identity set per namespace revision', () => {
    let creations = 0;
    const namespace = { revision: '1', createInitialProfile: factory('first', () => { creations++; }) };
    const integration = { namespace } as unknown as NamespaceIntegration;
    const owns = (tool: string) => NamespaceIntegration.prototype.owns.call(integration, tool);
    for (let i = 0; i < 100; i++) assert.equal(owns('first'), true);
    assert.equal(creations, 1);
    namespace.revision = '2';
    namespace.createInitialProfile = factory('second', () => { creations++; });
    assert.equal(owns('first'), false);
    assert.equal(owns('second'), true);
    assert.equal(creations, 2);
});
