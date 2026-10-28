import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const options = { absWorkingDir: root, bundle: true, minify: true, logLevel: 'info' };

/** @brief Compile server modules before bundling the self-contained restricted worker. */
async function buildServer() {
    const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);

    await build({
        ...options,
        entryPoints: ['src/runtime/worker.ts'],
        platform: 'node', format: 'esm', target: 'node24',
        outfile: 'dist/runtime/worker_bundle.mjs',
    });
}

/** @brief Build the host-backed plugin and the standalone page with their own dependency policies. */
async function buildClient() {
    const browser = { ...options, platform: 'browser', target: 'es2022', loader: { '.css': 'text', '.md': 'text' } };
    await build({
        ...browser,
        entryPoints: ['src/web/client.ts'],
        format: 'cjs', outfile: 'dist/client.js',
        external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', 'zod'],
        banner: { js: "window.__ModuleLoader__.load({id:'@aldveylor/dsh-intellisense',factory(require){const module={exports:{}};" },
        footer: { js: 'return module.exports;}});' },
    });
    await build({
        ...browser,
        entryPoints: ['src/web/standalone.tsx'],
        format: 'iife', outfile: 'dist/web/standalone.js',
    });
}

const target = process.argv[2] ?? 'all';
if (process.argv.length > 3 || !['all', 'server', 'client'].includes(target)) {
    throw new Error('Usage: node scripts/build/build.mjs [all|server|client]');
}
if (target === 'all' || target === 'server') await buildServer();
if (target === 'all' || target === 'client') await buildClient();
