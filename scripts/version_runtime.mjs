import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { satisfies, valid } from 'semver';
import { copyPackage } from './local_plugin.mjs';

/** @brief Install an isolated DSH host and refresh plugin copies without checkout development dependencies. */
export function prepareVersionRuntime(projectDir, version, plugins) {
    if (!valid(version)) throw new Error('--dsh-version requires an exact semantic version');
    const directory = join(projectDir, 'build/dsh_versions', version);
    mkdirSync(directory, { recursive: true });
    const metadataPath = join(directory, '.host_dependencies.json');
    const hostDependencies = existsSync(metadataPath)
        ? JSON.parse(readFileSync(metadataPath, 'utf8'))
        : JSON.parse(execFileSync('pnpm', ['view', `@deepseek-ai/dsh@${version}`, 'dependencies', '--json'], { encoding: 'utf8' }));
    writeFileSync(metadataPath, JSON.stringify(hostDependencies));
    const dependencies = {
        '@deepseek-ai/dsh': version,
        '@deepseek-ai/dsh-app-boot': version,
        '@deepseek-ai/cordis': hostDependencies['@deepseek-ai/cordis'],
    };
    // Older hosts export templates from app-boot and have no official-bundles package.
    if (hostDependencies['@deepseek-ai/dsh-official-bundles']) {
        dependencies['@deepseek-ai/dsh-official-bundles'] = hostDependencies['@deepseek-ai/dsh-official-bundles'];
    }
    const manifests = plugins.map(plugin => JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')));
    for (const manifest of manifests) {
        for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
            if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue;
            if (manifest.peerDependenciesMeta?.[name]?.optional && !satisfies(version, range, { includePrerelease: true })) continue;
            dependencies[name] = version;
        }
    }
    const manifestPath = join(directory, 'package.json');
    const manifest = { name: 'dsh-version-runtime', private: true, type: 'module', dependencies };
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    const marker = join(directory, '.installed');
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== serialized || !existsSync(join(directory, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'))) {
        rmSync(marker, { force: true });
        writeFileSync(manifestPath, serialized);
        execFileSync('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
        writeFileSync(marker, serialized);
    }
    const copies = plugins.map(plugin => {
        const key = createHash('sha256').update(plugin).digest('hex').slice(0, 16);
        const target = join(directory, 'plugins', key);
        rmSync(target, { recursive: true, force: true });
        copyPackage(plugin, target);
        return target;
    });
    return { require: createRequire(manifestPath), plugins: copies };
}
