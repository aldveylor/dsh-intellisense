import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot';

/** @brief Register a local package as a selected native profile bundle without copying its build. */
export function registerLocalPlugin(profileDir, pluginDir) {
    const directory = realpathSync(pluginDir);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? '') || !manifest.dsh?.bundle?.patch) {
        throw new Error(`Local plugin must declare a package name and dsh.bundle.patch: ${directory}`);
    }
    const target = join(profileDir, 'node_modules', manifest.name);
    let existing;
    try {
        existing = lstatSync(target);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
        if (realpathSync(target) !== directory) throw new Error(`Local plugin conflicts with existing package: ${target}`);
    } else {
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(directory, target, 'dir');
    }
    const profile = readProfileManifest('dsh', profileDir);
    const previous = JSON.stringify(profile);
    const dependency = profile.dependencies?.[manifest.name];
    if (dependency !== undefined && dependency !== `link:${directory}`) throw new Error(`Local plugin conflicts with profile dependency: ${manifest.name}`);
    profile.dependencies = { ...profile.dependencies, [manifest.name]: `link:${directory}` };
    const bundles = profile.dsh.profile.bundles = [...new Set(profile.dsh.profile.bundles)];
    if (!bundles.includes(manifest.name)) bundles.push(manifest.name);
    if (JSON.stringify(profile) !== previous) writeProfileManifest(profileDir, profile);
    return manifest.name;
}
