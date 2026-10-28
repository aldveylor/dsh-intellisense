import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { registerLocalPlugin } from '../../scripts/local_plugin.mjs';

test('copies a local bundle and its runtime dependencies when links fail, then refreshes it', async t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'local_plugin_'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'plugin');
    const profile = join(source, 'build/profile');
    const dependency = join(root, 'dependency');
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(join(source, 'node_modules'), { recursive: true });
    fs.mkdirSync(dependency);
    fs.writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'test-runtime', main: 'index.cjs' }));
    fs.writeFileSync(join(dependency, 'index.cjs'), 'module.exports = 42;');
    fs.symlinkSync(dependency, join(source, 'node_modules/test-runtime'), 'junction');
    fs.writeFileSync(join(source, 'package.json'), JSON.stringify({
        name: '@test/plugin', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } },
        dependencies: { 'test-runtime': '*' }, optionalDependencies: { 'missing-optional': '*' },
    }));
    fs.writeFileSync(join(source, 'index.js'), "import value from 'test-runtime'; export default value;");
    fs.writeFileSync(join(source, 'old.js'), 'obsolete');
    fs.writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['existing'] } } }));
    t.mock.method(fs, 'symlinkSync', () => { throw Object.assign(new Error('Link denied'), { code: 'EPERM' }); });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

    assert.equal(registerLocalPlugin(profile, source), '@test/plugin');
    const target = join(profile, 'node_modules/@test/plugin');
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(join(target, 'node_modules/test-runtime')).isSymbolicLink(), false);
    assert.equal(fs.existsSync(join(target, 'build')), false);
    assert.equal((await import(pathToFileURL(join(target, 'index.js')).href)).default, 42);
    const manifest = fs.readFileSync(join(profile, 'package.json'), 'utf8');
    assert.deepEqual(JSON.parse(manifest).dsh.profile.bundles, ['existing', '@test/plugin']);

    fs.rmSync(join(source, 'old.js'));
    fs.writeFileSync(join(source, 'index.js'), 'export default 43;');
    registerLocalPlugin(profile, source);
    assert.equal(fs.existsSync(join(target, 'old.js')), false);
    assert.equal((await import(`${pathToFileURL(join(target, 'index.js')).href}?updated`)).default, 43);
    assert.equal(fs.readFileSync(join(profile, 'package.json'), 'utf8'), manifest);

    fs.writeFileSync(join(target, '.local_plugin_source'), join(root, 'other'));
    assert.throws(() => registerLocalPlugin(profile, source), /conflicts with existing package/);
    assert.equal(fs.readFileSync(join(target, 'index.js'), 'utf8'), 'export default 43;');
});
