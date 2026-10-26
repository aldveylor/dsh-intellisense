import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { collectVersions } from '../../scripts/release/collect_versions.mjs';

/** @brief Create an isolated Git repository for release history scenarios. */
function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), 'release_history_'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-b', 'master');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.test');

  /** @brief Record package metadata in a new commit. */
  function commit(version: string) {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'release-test', version }));
    git('add', '.');
    git('commit', '--allow-empty', '-m', `Version ${version}`);
    return git('rev-parse', 'HEAD');
  }
  return { cwd, git, commit };
}

test('publishes every changed version from its introducing commit', t => {
  const { cwd, commit } = fixture(t);
  const before = commit('1.0');
  const first = commit('1.1');
  commit('1.1');
  const last = commit('1.2');
  assert.deepEqual(collectVersions(before, last, cwd), [
    { commit: first, name: 'release-test', version: '1.1' },
    { commit: last, name: 'release-test', version: '1.2' },
  ]);
});

test('keeps intermediate versions when the push ends at the original version', t => {
  const { cwd, commit } = fixture(t);
  const before = commit('1.0');
  const first = commit('1.1');
  const last = commit('1.0');
  assert.equal(collectVersions(before, last, cwd)[0].commit, first);
});

test('includes merged branch commits without duplicating inherited merge versions', t => {
  const { cwd, git, commit } = fixture(t);
  const before = commit('1.0');
  git('checkout', '-b', 'feature');
  const first = commit('1.1');
  commit('1.1');
  git('checkout', 'master');
  git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
  const after = git('rev-parse', 'HEAD');
  assert.deepEqual(collectVersions(before, after, cwd), [
    { commit: first, name: 'release-test', version: '1.1' },
  ]);
});

test('includes versions introduced by merge commits', t => {
  const { cwd, git, commit } = fixture(t);
  const before = commit('1.0');
  git('checkout', '-b', 'feature');
  commit('1.1');
  git('checkout', 'master');
  git('merge', '--no-ff', '--no-commit', 'feature');
  const merge = commit('1.2');
  assert.deepEqual(collectVersions(before, merge, cwd).map(({ version }) => version), ['1.1', '1.2']);
  assert.equal(collectVersions(before, merge, cwd)[1].commit, merge);
});

test('handles initial pushes, unchanged versions and empty ranges', t => {
  const { cwd, commit } = fixture(t);
  const first = commit('1.0');
  const last = commit('1.0');
  assert.deepEqual(collectVersions('0'.repeat(40), last, cwd), [
    { commit: first, name: 'release-test', version: '1.0' },
  ]);
  assert.deepEqual(collectVersions(first, last, cwd), []);
  assert.deepEqual(collectVersions(last, last, cwd), []);
});
