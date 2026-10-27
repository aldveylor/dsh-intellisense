import { execFileSync } from 'node:child_process';

/** @brief Collect the latest commit per unpublished version since successful releases. */
export function collectVersions(after, releasedTags = [], cwd = process.cwd()) {
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

  const range = [after, ...releasedTags.map(tag => `^refs/tags/${tag}`)];
  const commits = git('rev-list', '--reverse', '--topo-order', ...range).split('\n').filter(Boolean);
  const published = new Set(releasedTags);
  const releases = new Map();
  for (const commit of commits) {
    const current = readPackage(commit);
    if (!current?.version || published.has(`v${current.version}`)) continue;
    releases.set(current.version, { commit, name: current.name, version: current.version });
  }
  return [...releases.values()];
}
