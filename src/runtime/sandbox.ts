import { spawnSync } from 'node:child_process';

/** @brief Refuse loading when Node's permission model cannot deny filesystem access and process creation. */
export function verifySandbox(timeoutMs = 10_000): void {
    const probe = `
        const fs = require('node:fs');
        const childProcess = require('node:child_process');
        for (const scope of ['fs.read', 'fs.write', 'child', 'worker', 'addons', 'wasi', 'inspector']) {
            if (!process.permission || process.permission.has(scope)) process.exit(2);
        }
        for (const attempt of [() => fs.readFileSync(process.execPath), () => childProcess.execFileSync(process.execPath, ['--version'])]) {
            try { attempt(); process.exit(3); }
            catch (error) { if (error.code !== 'ERR_ACCESS_DENIED') process.exit(4); }
        }
        process.stdout.write('SANDBOX_OK');
    `;
    const result = spawnSync(process.execPath, ['--permission', '--eval', probe], { env: {}, encoding: 'utf8', timeout: timeoutMs });
    if (result.status !== 0 || result.stdout !== 'SANDBOX_OK') throw new Error(`Intellisense PTC sandbox unavailable: ${result.error?.message ?? result.stderr ?? result.status}`);
}
