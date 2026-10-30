import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error Runtime-only JavaScript helper has no declaration file.
import { prepareVersionRuntime } from '../../scripts/version_runtime.mjs';

test('explains unpublished versions without caching failed registry metadata', t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'version_runtime_'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const lookup = t.mock.method(childProcess, 'execFileSync', () => {
        throw Object.assign(new Error('Command failed'), {
            stdout: JSON.stringify({ error: { code: 'ERR_PNPM_PACKAGE_NOT_FOUND', message: 'No matching version found' } }),
        });
    });
    syncBuiltinESMExports();

    assert.throws(() => prepareVersionRuntime(root, '1.2.1-rc.2', []), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DSH version 1\.2\.1-rc\.2 is not published/);
        assert.match(error.message, /pnpm view @deepseek-ai\/dsh versions --json/);
        return true;
    });
    assert.deepEqual(lookup.mock.calls[0].arguments.slice(0, 2), [
        'pnpm', ['view', '@deepseek-ai/dsh@1.2.1-rc.2', 'dependencies', '--json'],
    ]);
    assert.equal(fs.existsSync(join(root, 'build/dsh_versions/1.2.1-rc.2/.host_dependencies.json')), false);
    assert.equal(fs.existsSync(join(root, 'build/dsh_versions/1.2.1-rc.2/.installed')), false);
});

test('preserves registry and process errors without claiming the version is unpublished', t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'version_runtime_'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    let failure = Object.assign(new Error('Command failed'), {
        stdout: JSON.stringify({ error: { code: 'ECONNRESET', message: 'Connection reset' } }),
        stderr: '',
    });
    t.mock.method(childProcess, 'execFileSync', () => { throw failure; });
    syncBuiltinESMExports();

    assert.throws(() => prepareVersionRuntime(root, '0.2.1-rc.2', []), /Unable to query DSH version 0\.2\.1-rc\.2: Connection reset/);
    failure = Object.assign(new Error('spawnSync pnpm ENOENT'), { stdout: '', stderr: '' });
    assert.throws(() => prepareVersionRuntime(root, '0.2.1-rc.2', []), /Unable to query DSH version 0\.2\.1-rc\.2: spawnSync pnpm ENOENT/);
});
