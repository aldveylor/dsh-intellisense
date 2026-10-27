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

test('selects the latest commit for every unpublished version', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  commit('1.1');
  const first = commit('1.1');
  const last = commit('1.2');
  assert.deepEqual(collectVersions(last, ['v1.0'], cwd), [
    { commit: first, name: 'release-test', version: '1.1' },
    { commit: last, name: 'release-test', version: '1.2' },
  ]);
});

test('retries failed releases on later pushes without a version bump', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  const failed = commit('1.1');
  assert.equal(collectVersions(failed, ['v1.0'], cwd)[0].commit, failed);
  const fixed = commit('1.1');
  assert.deepEqual(collectVersions(fixed, ['v1.0'], cwd), [
    { commit: fixed, name: 'release-test', version: '1.1' },
  ]);
  git('tag', 'v1.1');
  const after = commit('1.1');
  assert.deepEqual(collectVersions(after, ['v1.0', 'v1.1'], cwd), []);
});

test('does not treat a tag without a Release as successful publication', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  const fixed = commit('1.0');
  assert.equal(collectVersions(fixed, [], cwd)[0].commit, fixed);
});

test('keeps unpublished intermediate versions when returning to a released version', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  const first = commit('1.1');
  const last = commit('1.0');
  assert.deepEqual(collectVersions(last, ['v1.0'], cwd), [
    { commit: first, name: 'release-test', version: '1.1' },
  ]);
});

test('selects the merge commit when it inherits an unpublished version', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  git('checkout', '-b', 'feature');
  commit('1.1');
  commit('1.1');
  git('checkout', 'master');
  git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
  const after = git('rev-parse', 'HEAD');
  assert.deepEqual(collectVersions(after, ['v1.0'], cwd), [
    { commit: after, name: 'release-test', version: '1.1' },
  ]);
});

test('includes versions introduced by merge commits', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  git('tag', 'v1.0');
  git('checkout', '-b', 'feature');
  const first = commit('1.1');
  git('checkout', 'master');
  git('merge', '--no-ff', '--no-commit', 'feature');
  const merge = commit('1.2');
  assert.deepEqual(collectVersions(merge, ['v1.0'], cwd), [
    { commit: first, name: 'release-test', version: '1.1' },
    { commit: merge, name: 'release-test', version: '1.2' },
  ]);
});

test('uses the latest commits when no Release exists and stops at successful history', t => {
  const { cwd, git, commit } = fixture(t);
  commit('1.0');
  const last = commit('1.0');
  assert.deepEqual(collectVersions(last, [], cwd), [
    { commit: last, name: 'release-test', version: '1.0' },
  ]);
  git('tag', 'v1.0');
  assert.deepEqual(collectVersions(last, ['v1.0'], cwd), []);
});

test('ignores history before package creation', t => {
  const { cwd, git, commit } = fixture(t);
  git('commit', '--allow-empty', '-m', 'Initial commit');
  const last = commit('1.0');
  assert.deepEqual(collectVersions(last, [], cwd), [
    { commit: last, name: 'release-test', version: '1.0' },
  ]);
});
