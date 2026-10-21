import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(projectDir, 'build/workspace');
const dshConfigDir = join(projectDir, 'build/.dsh');
const plugins = new Set([projectDir]);
const args = [];
for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--plugin') {
        const directory = process.argv[++index];
        if (!directory || directory.startsWith('--')) throw new Error('--plugin requires a local package directory');
        plugins.add(resolve(directory));
    } else {
        args.push(argument);
    }
}

process.chdir(projectDir);
if (!existsSync('node_modules/@deepseek-ai/dsh/lib/profile-boot.js') || !existsSync('node_modules/typescript/bin/tsc')) {
    execFileSync('npm', ['ci', '--prefix', projectDir], { stdio: 'inherit' });
}
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

mkdirSync(workspaceDir, { recursive: true });
process.env.DSH_HOME = process.env.DSH_HOME?.trim()
    ? resolve(process.env.DSH_HOME)
    : dshConfigDir;
process.chdir(workspaceDir);
console.log(`Workspace: ${workspaceDir}\nDSH_HOME: ${process.env.DSH_HOME}`);

const { initProfile, loadLayeredEnv, PROFILE_TEMPLATES, resolveProfileDir } = await import('@deepseek-ai/dsh-app-boot');
const { registerLocalPlugin } = await import('./scripts/local_plugin.mjs');
const profileDir = resolveProfileDir('web');
initProfile(profileDir, PROFILE_TEMPLATES.web.bundles);
for (const directory of plugins) {
    console.log(`Local plugin: ${registerLocalPlugin(profileDir, directory)}`);
}
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [],
    args,
});

try {
    await ctx.get('workspaceRegistry')?.create(workspaceDir);
} catch (error) {
    await shutdown.shutdown(1);
    throw error;
}
