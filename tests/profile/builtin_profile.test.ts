import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NamespaceDefinitions } from '../../src/profile/namespace/definitions.js';
import { ImplToolsProfileNamespace } from '../../src/tools/profile_nodes/impl_tools_profile_namespace.js';
import { RootNamespace } from '../../src/tools/profile_nodes/root_namespace.js';
import { ProfileReference } from '../../src/profile/snapshot_store.js';
import type { NamespaceTreeNode } from '../../src/profile/catalog/profile_node.js';

test('Profile hydration restores delete as remove in constructors and snapshot copies', () => {
    const root = new RootNamespace().serialize();
    const profile = root.children!.tools!.children!.profile! as NamespaceTreeNode;
    const remove = profile.children!.remove!;
    profile.children!.delete = { ...remove, disabled: true, fixedLevel: 2, function: { tool: 'tools_profile_delete' } };
    delete profile.children!.remove;
    const stored = structuredClone(root);
    const reference = new ProfileReference(1, { root }, new NamespaceDefinitions());
    const restored = [
        new ImplToolsProfileNamespace(profile),
        new ImplToolsProfileNamespace().copyNode(profile),
        new RootNamespace({ root }).get('tools')!.serialize().children!.profile!,
        new RootNamespace().clone({ root }).serialize().children!.tools!.children!.profile!,
        reference.snapshot.serialize().children!.tools!.children!.profile!,
    ];
    for (const value of restored) {
        const children = 'serialize' in value ? value.serialize().children! : value.children!;
        assert.equal(Object.hasOwn(children, 'delete'), false);
        assert.equal(children.remove!.function!.tool, 'tools_profile_remove');
        assert.equal(children.remove!.disabled, true);
        assert.equal(children.remove!.fixedLevel, 2);
    }
    assert.deepEqual(root, stored);
});

test('Profile hydration prefers current remove settings and rejects unknown members', () => {
    const data = new ImplToolsProfileNamespace().serialize();
    data.children!.remove!.fixedLevel = 1;
    data.children!.delete = { type: 'function', disabled: true, function: { tool: 'tools_profile_delete' } };
    const restored = new ImplToolsProfileNamespace(data).serialize();
    assert.equal(restored.children!.remove!.fixedLevel, 1);
    assert.equal(restored.children!.remove!.disabled, undefined);
    data.children!.unknown = { type: 'function', function: { tool: 'unknown' } };
    assert.throws(() => new ImplToolsProfileNamespace(data), /Invalid builtin Profile member: unknown/);
});
