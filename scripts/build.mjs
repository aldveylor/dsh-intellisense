import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Remove stale modules so deleted source interfaces cannot survive in published output.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [new URL('../node_modules/typescript/bin/tsc', import.meta.url).pathname, '-p', 'tsconfig.json'], { stdio: 'inherit' });
await import('./build_client.mjs');
