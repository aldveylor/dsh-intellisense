import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @brief Rewrite local README images to raw GitHub URLs. */
export function convertReadmeImages(markdown, repository, ref = 'master') {
  const repositoryPath = new URL(repository.replace(/^git\+/, '').replace(/\.git$/, '')).pathname.slice(1);

  /** @brief Preserve remote URLs and route local images to the raw host. */
  function imageUrl(value) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return value;
    const path = posix.normalize(value.replace(/^\//, ''));
    return `https://raw.githubusercontent.com/${repositoryPath}/${encodeURIComponent(ref)}/${path}`;
  }

  return markdown
    .replace(/(!\[[^\]\n]*\]\(\s*)(<[^>\n]+>|[^\s)]+)(?=[\s)])/g, (_, prefix, value) =>
      prefix + (value.startsWith('<') ? `<${imageUrl(value.slice(1, -1))}>` : imageUrl(value)))
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (_, prefix, quote, value) =>
      `${prefix}${quote}${imageUrl(value)}${quote}`);
}

/** @brief Stage publishable files and transform only the staged README copies. */
export function preparePackage(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const directory = join(root, manifest.publishConfig.directory);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const file of manifest.files) {
    cpSync(join(root, file), join(directory, file), { recursive: true });
    if (/^README(?:\.[\w-]+)?\.md$/i.test(file)) {
      const markdown = readFileSync(join(directory, file), 'utf8');
      writeFileSync(join(directory, file), convertReadmeImages(markdown, manifest.repository.url));
    }
  }
  delete manifest.scripts;
  delete manifest.publishConfig.directory;
  delete manifest.publishConfig.linkDirectory;
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

if (import.meta.main) preparePackage(fileURLToPath(new URL('../..', import.meta.url)));
