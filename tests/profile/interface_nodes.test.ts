import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditableCommand, type ProfileCommand } from '../../src/profile/command.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import type { ProfileCheckContext } from '../../src/profile/node.js';
import type { CommandNode, ProfileTreeNode } from '../../src/profile/catalog/profile_node.js';
import type { Permission } from '../../src/profile/namespace/node.js';

/** @brief Provider-owned command with private state implementing the interface without inheriting EditableNode. */
class InterfaceCommand implements ProfileCommand {
    readonly type = 'command';
    path = '';
    #command: EditableCommand;

    constructor(data: CommandNode = { type: 'command', command: { tool: 'read', doc: 'Provider command' } }) { this.#command = new EditableCommand('', data); }

    get tool() { return this.#command.tool; }
    get disabled() { return this.#command.disabled; }
    get permissions() { return this.#command.permissions; }

    copyNode(value: ProfileTreeNode): this {
        assert.equal(value.type, 'command');
        const result = new InterfaceCommand(value as CommandNode) as this;
        result.#command = this.#command.copyNode(value);
        result.path = this.path;
        return result;
    }

    bindName(path: string): void { this.#command.bindName(path); this.path = path; }
    setPermissions(value: Partial<Permission>): this { this.#command.setPermissions(value); return this; }
    setDisabled(value: boolean): this { this.#command.setDisabled(value); return this; }
    setTool(value: string): this { this.#command.setTool(value); return this; }
    setDescription(value: string): this { this.#command.setDescription(value); return this; }
    setFixedLevel(value: 0 | 1 | 2): this { this.#command.setFixedLevel(value); return this; }
    check(context: ProfileCheckContext, path?: string, original?: ProfileTreeNode): void { this.#command.check(context, path, original); }
    assertRemovable(): void { this.#command.assertRemovable(); }
    apply(value: Record<string, unknown>): this { this.#command.apply(value); return this; }
    normalize(value: ProfileTreeNode): ProfileTreeNode { return this.#command.normalize(value); }
    serialize(): CommandNode { return this.#command.serialize(); }
}

test('interface nodes preserve provider behavior and private state through clone, hydration and apply', () => {
    const profile = new EditableSnapshot();
    const group = profile.create('files', () => new EditableNamespace());
    const original = group.create('read', () => new InterfaceCommand());
    assert.equal(original.path, 'files.read');

    const data = { root: profile.serialize(), brief: 'Hydrated' };
    data.root.children!.files!.children!.read!.command!.doc = 'Loaded description';
    const restored = profile.clone(data);
    const copied = restored.resolve('files.read') as InterfaceCommand;
    assert(copied instanceof InterfaceCommand);
    assert.notEqual(copied, original);
    assert.equal(copied.path, 'files.read');
    assert.equal(copied.serialize().command.doc, 'Loaded description');
    assert.equal(original.serialize().command.doc, 'Provider command');

    restored.apply({ root: { children: { files: { children: { read: { command: { doc: 'Patched' } } } } } } });
    const patched = restored.resolve('files.read') as InterfaceCommand;
    assert(patched instanceof InterfaceCommand);
    assert.equal(patched.serialize().command.doc, 'Patched');
    assert.equal(copied.serialize().command.doc, 'Loaded description');
});

test('interface nodes enforce binding policies and retained protected children are independently copied', () => {
    const profile = new EditableSnapshot();
    const group = profile.create('files', () => new EditableNamespace());
    const command = group.create('read', () => new InterfaceCommand()).setPermissions({ renamable: false, movable: false, removable: false });
    assert.throws(() => group.set('renamed', command), /cannot be renamed/);
    assert.throws(() => profile.set('read', command), /cannot be moved/);
    assert.equal(command.path, 'files.read');

    const copy = group.copyNode({ type: 'namespace', children: {} });
    const retained = copy.get('read') as InterfaceCommand;
    assert(retained instanceof InterfaceCommand);
    assert.notEqual(retained, command);
    retained.setDescription('Independent');
    assert.equal(command.serialize().command.doc, 'Provider command');
    assert.throws(() => copy.remove('read'), /cannot be removed/);
});
