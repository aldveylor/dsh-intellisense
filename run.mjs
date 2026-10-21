import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(projectDir, 'build/workspace');
const dshConfigDir = join(projectDir, 'build/.dsh');
const patchPath = join(projectDir, 'build/run.patch.yml');

process.chdir(projectDir);
if (!existsSync('node_modules/@deepseek-ai/dsh/lib/profile-boot.js') || !existsSync('node_modules/typescript/bin/tsc')) {
    execFileSync('npm', ['ci', '--prefix', projectDir], { stdio: 'inherit' });
}
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

mkdirSync(workspaceDir, { recursive: true });
const patch = readFileSync('cordis.patch.yml', 'utf8')
    .replace('name: dsh-ts-intellisense', `name: ${JSON.stringify(join(projectDir, 'dist/index.js'))}`);
writeFileSync(patchPath, patch);

process.env.DSH_HOME = process.env.DSH_HOME?.trim()
    ? resolve(process.env.DSH_HOME)
    : dshConfigDir;
process.chdir(workspaceDir);
console.log(`Workspace: ${workspaceDir}\nDSH_HOME: ${process.env.DSH_HOME}`);

const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [patchPath],
    args: process.argv.slice(2),
});

try {
    await ctx.get('workspaceRegistry')?.create(workspaceDir);
} catch (error) {
    await shutdown.shutdown(1);
    throw error;
}
