import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

// Native DSH clients share the shell's React instance through its lazy module loader.
const native = await build({
    entryPoints: ['src/web/client.ts'], bundle: true, platform: 'browser', format: 'cjs',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], write: false, target: 'es2022',
});
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:"dsh-ts-intellisense",factory(require){\nconst module={exports:{}};\n${native.outputFiles[0].text}\nreturn module.exports;\n}});\n`);

// The standalone authenticated page owns its React root and needs no shell globals.
await build({
    entryPoints: ['src/web/standalone.tsx'], bundle: true, platform: 'browser', format: 'iife',
    outfile: 'dist/web/standalone.js', target: 'es2022', minify: true,
});
