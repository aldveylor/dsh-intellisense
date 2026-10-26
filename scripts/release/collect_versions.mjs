import { execFileSync } from 'node:child_process';

/** @brief Collect the first commit introducing each version in the pushed history. */
export function collectVersions(before, after, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const packages = new Map();

  /** @brief Read package metadata at a commit, allowing history before package creation. */
  function readPackage(commit) {
    if (!packages.has(commit)) {
      packages.set(commit, git('ls-tree', '--name-only', commit, '--', 'package.json')
        ? JSON.parse(git('show', `${commit}:package.json`))
        : undefined);
    }
    return packages.get(commit);
  }

  const range = /^0+$/.test(before) ? [after] : [after, `^${before}`];
  const commits = git('rev-list', '--reverse', '--topo-order', ...range).split('\n').filter(Boolean);
  const versions = new Set();
  const releases = [];
  for (const commit of commits) {
    const current = readPackage(commit);
    if (!current?.version || versions.has(current.version)) continue;
    const parents = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1);
    if (parents.some(parent => readPackage(parent)?.version === current.version)) continue;
    versions.add(current.version);
    releases.push({ commit, name: current.name, version: current.version });
  }
  return releases;
}
