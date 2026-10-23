import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

// Native DSH clients share the shell's React instance through its lazy module loader.
const native = await build({
    entryPoints: ['src/web/client.ts'], bundle: true, platform: 'browser', format: 'cjs',
    loader: { '.css': 'text' },
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], write: false, target: 'es2022',
});
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:"dsh-ts-intellisense",factory(require){\nconst module={exports:{}};\n${native.outputFiles[0].text}\nreturn module.exports;\n}});\n`);

// The standalone authenticated page owns its React root and needs no shell globals.
await build({
    entryPoints: ['src/web/standalone.tsx'], bundle: true, platform: 'browser', format: 'iife',
    loader: { '.css': 'text' },
    outfile: 'dist/web/standalone.js', target: 'es2022', minify: true,
});

// The worker is loaded as an inline module under Node permissions, requiring no filesystem grants.
await build({ entryPoints: ['src/runtime_host/worker.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist/runtime_host/worker_bundle.mjs', target: 'node24', minify: true });
