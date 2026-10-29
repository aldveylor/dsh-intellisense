import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error Runtime-only JavaScript helper has no declaration file.
import { convertReadmeImages, preparePackage } from '../../scripts/release/prepare_package.mjs';

test('routes local images to raw GitHub URLs while preserving external URLs and document links', () => {
  const markdown = [
    '![banner](assets/banner.png "Banner")',
    '![icon](./assets/icon.png)',
    '![icon](assets/icon.svg)',
    '![screen](<./assets/en/screen.png>)',
    '<img alt="screen" src="assets/zh/screen.png">',
    '![badge](https://example.com/badge.svg)',
    '![badge](//example.com/badge.svg)',
    '![inline](data:image/png;base64,abc)',
    '[中文](README.zh-cn.md)',
  ].join('\n');
  const converted = convertReadmeImages(markdown, 'git+https://github.com/example/plugin.git');
  assert.equal(converted, [
    '![banner](https://raw.githubusercontent.com/example/plugin/master/assets/banner.png "Banner")',
    '![icon](https://raw.githubusercontent.com/example/plugin/master/assets/icon.png)',
    '![icon](https://raw.githubusercontent.com/example/plugin/master/assets/icon.svg)',
    '![screen](<https://raw.githubusercontent.com/example/plugin/master/assets/en/screen.png>)',
    '<img alt="screen" src="https://raw.githubusercontent.com/example/plugin/master/assets/zh/screen.png">',
    '![badge](https://example.com/badge.svg)',
    '![badge](//example.com/badge.svg)',
    '![inline](data:image/png;base64,abc)',
    '[中文](README.zh-cn.md)',
  ].join('\n'));
  assert.equal(convertReadmeImages(converted, 'git+https://github.com/example/plugin.git'), converted);
});

test('stages both READMEs without changing source files and removes stale output on repeat prepares', t => {
  const root = mkdtempSync(join(tmpdir(), 'prepare_package_'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const markdown = '![banner](assets/banner.png)\n';
  const manifest = {
    name: 'prepare-package-test', version: '1.0.0',
    files: ['dist', 'README.md', 'README.zh-cn.md'],
    repository: { url: 'git+https://github.com/example/plugin.git' },
    publishConfig: { directory: 'build/package', linkDirectory: false },
    scripts: { prepare: 'unavailable-source-script' },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.js'), 'export {};\n');
  for (const file of ['README.md', 'README.zh-cn.md']) writeFileSync(join(root, file), markdown);
  const directory = preparePackage(root);
  writeFileSync(join(directory, 'stale.txt'), 'obsolete');
  preparePackage(root);
  assert.equal(existsSync(join(directory, 'stale.txt')), false);
  assert.equal(readFileSync(join(directory, 'dist/index.js'), 'utf8'), 'export {};\n');
  for (const file of ['README.md', 'README.zh-cn.md']) {
    assert.equal(readFileSync(join(root, file), 'utf8'), markdown);
    assert.equal(readFileSync(join(directory, file), 'utf8'), '![banner](https://raw.githubusercontent.com/example/plugin/master/assets/banner.png)\n');
  }
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), manifest);
  const staged = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  assert.equal(staged.scripts, undefined);
  assert.equal(staged.publishConfig.directory, undefined);
  assert.equal(staged.name, manifest.name);
});
