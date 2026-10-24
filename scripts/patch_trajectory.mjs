import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** @brief Extend the pinned native trajectory code view without renaming recorded tools. */
export function patchTrajectory(source) {
    const replacements = [
        ['const PTC_TOOL_NAME = "run_code";', 'const PTC_TOOL_NAME = "run_code";\n\t\tconst isCodeTool = name => name === PTC_TOOL_NAME || name === "tools_run_code";'],
        ['cell.toolName !== "run_code" ||', '!isCodeTool(cell.toolName) ||'],
        ['`${PTC_TOOL_NAME} · ${program.description', '`${cell.toolName} · ${program.description'],
        ['const program = cell.toolName === PTC_TOOL_NAME;', 'const program = isCodeTool(cell.toolName);'],
    ];
    if (source.includes(replacements[0][1])) {
        if (replacements.every(([, patched]) => source.includes(patched))) return source;
        throw new Error('Incomplete trajectory code-view patch');
    }
    for (const [original] of replacements) {
        if (source.split(original).length !== 2) throw new Error(`Unsupported trajectory code-view source: ${original}`);
    }
    for (const [original, patched] of replacements) source = source.replace(original, patched);
    return source;
}

/** @brief Patch the installed trajectory bundle; reject dependency changes before writing. */
export async function patchInstalledTrajectory() {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve('@deepseek-ai/dsh-client-ui-trajectory/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== '0.2.1-rc.2') throw new Error(`Unsupported trajectory version: ${manifest.version}`);
    const clientPath = new URL('./lib/client.js', pathToFileURL(manifestPath));
    const source = await readFile(clientPath, 'utf8');
    const patched = patchTrajectory(source);
    if (patched !== source) await writeFile(clientPath, patched);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await patchInstalledTrajectory();
