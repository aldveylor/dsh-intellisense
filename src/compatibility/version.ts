import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gte, valid } from 'semver';

/** @brief Identify the tool API generation from the installed DSH package version. */
export function generationFor(version: string): 'legacy' | 'executor' {
    if (!valid(version) || !gte(version, '0.2.1-rc.2')) throw new Error(`Unsupported DSH version: ${version}`);
    return gte(version, '0.2.2-alpha.2') ? 'executor' : 'legacy';
}

const require = createRequire(import.meta.url);
/** @brief Read the API package resolved by this plugin rather than a potentially different CLI installation. */
export const dshVersion: string = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-tools/package.json'), 'utf8')).version;
/** @brief Select the adapter once, before importing any version-specific runtime modules. */
export const apiGeneration = generationFor(dshVersion);
