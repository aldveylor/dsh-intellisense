import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditableSnapshot } from '../../src/profile/snapshot.js';
import { EditableNamespace } from '../../src/profile/namespace.js';
import { EditableFunction } from '../../src/profile/function.js';
import { PlaneProfile } from '../../src/profile/plane/profile.js';
import { toPlaneProfile } from '../../src/profile/plane/to_plane_profile.js';
import { profileTree } from '../../src/profile/catalog/profile_tree.js';

test('toPlaneProfile flattens snapshots and retains detached editor preferences and node settings', () => {
    const profile = new EditableSnapshot().setBrief('Workspace commands');
    const files = profile.create('files', () => new EditableNamespace()).setDescription('File operations').setFixedLevel(1);
    files.create('read', () => new EditableFunction('', { type: 'function', function: { tool: 'read_file', doc: 'Read a file' }, fixedLevel: 2, disabled: true }));
    const current = new PlaneProfile({ mappings: [{ id: 'read_file', path: 'files.read', pinned: true }],
        unmountedVisible: { other_tool: 1 }, toolComments: { other_tool: 'Other command' } });

    const plane = toPlaneProfile(profile, current);
    assert(plane instanceof PlaneProfile);
    assert.equal(plane.brief, 'Workspace commands');
    assert.deepEqual(plane.mappings, [{ id: 'read_file', path: 'files.read', pinned: true, description: 'Read a file', alwaysVisible: 2, disabled: true }]);
    assert.deepEqual(plane.namespaces, [{ path: 'files', description: 'File operations', alwaysVisible: true }]);
    assert.deepEqual(plane.order, ['files', 'files.read']);
    assert.deepEqual(JSON.parse(JSON.stringify(profileTree('Example', plane).root.children)), JSON.parse(JSON.stringify(profile.serialize().children)));
    assert.deepEqual(toPlaneProfile({ name: 'Example', root: profile.serialize(), brief: profile.brief }, current).save(), plane.save());

    plane.unmountedVisible.other_tool = 2;
    plane.toolComments.other_tool = 'Changed';
    plane.mappings[0]!.path = 'changed';
    assert.equal(current.unmountedVisible.other_tool, 1);
    assert.equal(current.toolComments.other_tool, 'Other command');
    assert.equal(current.mappings[0]!.path, 'files.read');
    assert(profile.resolve('files'));
});

test('toPlaneProfile accepts a snapshot without editor state', () => {
    const profile = new EditableSnapshot().setBrief('Empty');
    const plane = toPlaneProfile(profile);
    assert.equal(plane.brief, 'Empty');
    assert.deepEqual(plane.mappings, []);
    assert.deepEqual(plane.order, []);
    assert.deepEqual(plane.unmountedVisible, {});
});
