import { applyProfile } from '../../src/profile/edit.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditableFunction, type ProfileFunction } from '../../src/profile/function.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import type { ProfileCheckContext } from '../../src/profile/node.js';
import type { FunctionNode, ProfileTreeNode } from '../../src/profile/catalog/profile_node.js';
import type { Permission } from '../../src/profile/namespace/node.js';

/** @brief Provider-owned function with private state implementing the interface without inheriting EditableNode. */
class InterfaceFunction implements ProfileFunction {
    readonly type = 'function';
    path = '';
    #implementation: EditableFunction;

    constructor(data: FunctionNode = { type: 'function', function: { tool: 'read', doc: 'Provider command' } }) { this.#implementation = new EditableFunction('', data); }

    get tool() { return this.#implementation.tool; }
    get fixedLevel() { return this.#implementation.fixedLevel; }
    get disabled() { return this.#implementation.disabled; }
    get permissions() { return this.#implementation.permissions; }

    copyNode(value: ProfileTreeNode): this {
        assert.equal(value.type, 'function');
        const result = new InterfaceFunction(value as FunctionNode) as this;
        result.#implementation = this.#implementation.copyNode(value);
        result.path = this.path;
        return result;
    }

    bindName(path: string): void { this.#implementation.bindName(path); this.path = path; }
    setPermissions(value: Partial<Permission>): this { this.#implementation.setPermissions(value); return this; }
    setDisabled(value: boolean): this { this.#implementation.setDisabled(value); return this; }
    setTool(value: string): this { this.#implementation.setTool(value); return this; }
    setDescription(value: string | undefined): this { this.#implementation.setDescription(value); return this; }
    setFixedLevel(value: 0 | 1 | 2): this { this.#implementation.setFixedLevel(value); return this; }
    check(context: ProfileCheckContext, path?: string, original?: ProfileTreeNode): void { this.#implementation.check(context, path, original); }
    assertRemovable(): void { this.#implementation.assertRemovable(); }
    normalize(value: ProfileTreeNode): ProfileTreeNode { return this.#implementation.normalize(value); }
    serialize(): FunctionNode { return this.#implementation.serialize(); }
}

test('interface nodes preserve provider behavior and private state through clone, hydration and apply', () => {
    const profile = new EditableSnapshot();
    const group = profile.create('files', () => new EditableNamespace());
    const original = group.create('read', () => new InterfaceFunction());
    assert.equal(original.path, 'files.read');

    const data = { root: profile.serialize(), brief: 'Hydrated' };
    data.root.children!.files!.children!.read!.function!.doc = 'Loaded description';
    const restored = profile.clone(data);
    const copied = restored.resolve('files.read') as InterfaceFunction;
    assert(copied instanceof InterfaceFunction);
    assert.notEqual(copied, original);
    assert.equal(copied.path, 'files.read');
    assert.equal(copied.serialize().function.doc, 'Loaded description');
    assert.equal(original.serialize().function.doc, 'Provider command');

    const updated = applyProfile(restored, { root: { children: { files: { children: { read: { function: { doc: 'Patched' } } } } } } });
    const patched = updated.resolve('files.read') as InterfaceFunction;
    assert(patched instanceof InterfaceFunction);
    assert.equal(patched.serialize().function.doc, 'Patched');
    assert.equal(copied.serialize().function.doc, 'Loaded description');
});

test('interface nodes enforce binding policies and retained protected children are independently copied', () => {
    const profile = new EditableSnapshot();
    const group = profile.create('files', () => new EditableNamespace());
    const command = group.create('read', () => new InterfaceFunction()).setPermissions({ renamable: false, movable: false, removable: false });
    assert.throws(() => group.set('renamed', command), /cannot be renamed/);
    assert.throws(() => profile.set('read', command), /cannot be moved/);
    assert.equal(command.path, 'files.read');

    const copy = group.copyNode({ type: 'namespace', children: {} });
    const retained = copy.get('read') as InterfaceFunction;
    assert(retained instanceof InterfaceFunction);
    assert.notEqual(retained, command);
    retained.setDescription('Independent');
    assert.equal(command.serialize().function.doc, 'Provider command');
    assert.throws(() => copy.remove('read'), /cannot be removed/);
});
