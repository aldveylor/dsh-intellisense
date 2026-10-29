import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(projectDir, 'build/workspace');
const dshConfigDir = join(projectDir, 'build/.dsh');
const plugins = new Set([projectDir]);
const args = [];
let dshVersion;
for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--') {
        args.push(...process.argv.slice(index + 1));
        break;
    } else if (argument === '--dsh-version' || argument.startsWith('--dsh-version=')) {
        const version = argument === '--dsh-version' ? process.argv[++index] : argument.slice('--dsh-version='.length);
        if (!version || version.startsWith('--')) throw new Error('--dsh-version requires an exact semantic version');
        dshVersion = version;
    } else if (argument === '--plugin') {
        const directory = process.argv[++index];
        if (!directory || directory.startsWith('--')) throw new Error('--plugin requires a local package directory');
        plugins.add(resolve(directory));
    } else {
        args.push(argument);
    }
}

process.chdir(projectDir);
if (!existsSync('node_modules/@deepseek-ai/dsh/lib/profile-boot.js') || !existsSync('node_modules/typescript/bin/tsc')) {
    // Installation builds the project through the package's prepare lifecycle.
    execFileSync('pnpm', ['install', '--frozen-lockfile'], { stdio: 'inherit' });
} else {
    execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit' });
}

let runtime = { require: createRequire(import.meta.url), plugins: [...plugins] };
if (dshVersion) {
    const { prepareVersionRuntime } = await import('./scripts/version_runtime.mjs');
    runtime = prepareVersionRuntime(projectDir, dshVersion, [...plugins].map(directory => realpathSync(directory)));
    console.log(`DSH version: ${dshVersion}`);
}

mkdirSync(workspaceDir, { recursive: true });
process.env.DSH_HOME = process.env.DSH_HOME?.trim()
    ? resolve(process.env.DSH_HOME)
    : dshConfigDir;
process.chdir(workspaceDir);
console.log(`Workspace: ${workspaceDir}\nDSH_HOME: ${process.env.DSH_HOME}`);

const appBoot = await import(pathToFileURL(runtime.require.resolve('@deepseek-ai/dsh-app-boot')).href);
const { initProfile, loadLayeredEnv, resolveProfileDir } = appBoot;
const { PROFILE_TEMPLATES } = appBoot.PROFILE_TEMPLATES
    ? appBoot
    : await import(pathToFileURL(runtime.require.resolve('@deepseek-ai/dsh-official-bundles')).href);
const { registerLocalPlugin } = await import('./scripts/local_plugin.mjs');
// Each checkout and local plugin selection owns a separate development profile.
const profileName = `intellisense_${createHash('sha256').update(JSON.stringify([...plugins].map(directory => realpathSync(directory)).sort()) + (dshVersion ?? '')).digest('hex').slice(0, 16)}`;
const profileDir = resolveProfileDir(profileName);
console.log(`Development profile: ${profileName}`);
initProfile(profileDir, PROFILE_TEMPLATES.web.bundles);
for (const directory of runtime.plugins) {
    console.log(`Local plugin: ${registerLocalPlugin(profileDir, directory)}`);
}
const { runProfile } = await import(pathToFileURL(runtime.require.resolve('@deepseek-ai/dsh/profile-boot')).href);
const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: profileName,
    patchFiles: [],
    args,
});

try {
    await ctx.get('workspaceRegistry')?.create(workspaceDir);
} catch (error) {
    await shutdown.shutdown(1);
    throw error;
}
