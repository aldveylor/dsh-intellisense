import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableFunction } from '../../src/profile/function.js';
import { serializeProfile } from '../../src/profile/namespace/namespace.js';
import { ToolAdditions } from '../../src/integration/tool_additions/tool_additions.js';

test('namespace serialization keeps nested settings and output independent', () => {
    const profile = new EditableSnapshot();
    const group = profile.create('files', () => new EditableNamespace()).setDescription('Files');
    group.create('read', () => new EditableFunction()).setTool('read');
    group.setPermissions({ availableFixLevels: [0, 1] });
    const first = profile.serialize();
    (first.children!.files!.permissions!.availableFixLevels as Array<0 | 1 | 2>).push(2);
    first.children!.files!.children!.read!.function!.tool = 'changed';
    const second = profile.serialize();
    assert.deepEqual(second.children!.files!.permissions!.availableFixLevels, [0, 1]);
    assert.equal(second.children!.files!.children!.read!.function!.tool, 'read');
    group.setDescription('Updated');
    assert.equal(second.children!.files!.description, 'Files');
});

test('browser projection reads containers without recursively serializing their descendants', () => {
    const profile = new EditableSnapshot();
    let parent: EditableNamespace = profile;
    for (let i = 0; i < 30; i++) {
        parent = parent.create(`level${i}`, () => new EditableNamespace()).setDescription(`Depth ${i}`).setFixedLevel(1);
        parent.serialize = () => { throw new Error('Container serialization must not run during DTO projection'); };
    }
    parent.create('read', () => new EditableFunction()).setTool('read');
    let node = serializeProfile(profile, [{ id: 'read', description: 'Read', parameters: {}, output: {} }], 'native', new ToolAdditions());
    for (let i = 0; i < 30; i++) {
        node = node.children![0]!;
        assert.equal(node.name, `level${i}`);
        assert.equal(node.description, `Depth ${i}`);
        assert.equal(node.fixedLevel, 1);
    }
    assert.equal(node.children![0]!.function!.tool, 'read');
});
