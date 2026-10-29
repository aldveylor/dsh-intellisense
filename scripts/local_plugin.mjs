import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot';

/** @brief Copy runtime packages without development dependencies, checkout metadata or recursive build output. */
export function copyPackage(directory, target, ancestors = new Set()) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(directory)) {
        if (['.git', 'build', 'node_modules'].includes(entry)) continue;
        cpSync(join(directory, entry), join(target, entry), { recursive: true, dereference: true });
    }
    const lineage = new Set([...ancestors, directory]);
    const require = createRequire(join(directory, 'package.json'));
    for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})])) {
        const dependency = require.resolve.paths(name)?.map(path => join(path, name)).find(path => existsSync(join(path, 'package.json')));
        if (!dependency) {
            if (name in (manifest.optionalDependencies ?? {})) continue;
            throw new Error(`Local plugin dependency not installed: ${name} (${directory})`);
        }
        const source = realpathSync(dependency);
        if (!lineage.has(source)) copyPackage(source, join(target, 'node_modules', name), lineage);
    }
}

/** @brief Register a local bundle using a directory link, or a refreshed runtime copy when linking fails. */
export function registerLocalPlugin(profileDir, pluginDir) {
    const directory = realpathSync(pluginDir);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? '') || !manifest.dsh?.bundle?.patch) {
        throw new Error(`Local plugin must declare a package name and dsh.bundle.patch: ${directory}`);
    }
    const target = join(profileDir, 'node_modules', manifest.name);
    const profile = readProfileManifest('dsh', profileDir);
    const dependency = profile.dependencies?.[manifest.name];
    if (dependency !== undefined && dependency !== `link:${directory}`) throw new Error(`Local plugin conflicts with profile dependency: ${manifest.name}`);
    const marker = join(target, '.local_plugin_source');
    let existing;
    try {
        existing = lstatSync(target);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    let copy = false;
    if (existing) {
        if (existing.isDirectory() && existsSync(marker) && readFileSync(marker, 'utf8') === directory) copy = true;
        else if (realpathSync(target) !== directory) throw new Error(`Local plugin conflicts with existing package: ${target}`);
    } else {
        mkdirSync(dirname(target), { recursive: true });
        try { symlinkSync(directory, target, 'dir'); }
        catch (error) {
            if (existsSync(target)) throw error;
            copy = true;
        }
    }
    if (copy) {
        rmSync(target, { recursive: true, force: true });
        try {
            copyPackage(directory, target);
            writeFileSync(marker, directory);
        } catch (error) {
            rmSync(target, { recursive: true, force: true });
            throw error;
        }
    }
    const previous = JSON.stringify(profile);
    profile.dependencies = { ...profile.dependencies, [manifest.name]: `link:${directory}` };
    const bundles = profile.dsh.profile.bundles = [...new Set(profile.dsh.profile.bundles)];
    if (!bundles.includes(manifest.name)) bundles.push(manifest.name);
    if (JSON.stringify(profile) !== previous) writeProfileManifest(profileDir, profile);
    return manifest.name;
}
