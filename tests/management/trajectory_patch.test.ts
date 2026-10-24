import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const { patchTrajectory } = await import(new URL('../../scripts/patch_trajectory.mjs', import.meta.url).href);
const require = createRequire(import.meta.url);
const bundle = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-trajectory/client'), 'utf8');

test('trajectory dependency patch is repeatable and rejects changed anchors before mutation', () => {
    const patched = patchTrajectory(bundle);
    assert.equal(patchTrajectory(patched), patched);
    assert.throws(() => patchTrajectory('upstream changed'), /Unsupported trajectory/);
    assert.throws(() => patchTrajectory(patched.replace('const program = isCodeTool(cell.toolName);', 'changed')), /Incomplete trajectory/);
});

test('native trajectory code parser recognizes both execution tools and preserves recorded source', () => {
    const patched = patchTrajectory(bundle);
    const start = patched.indexOf('const PTC_TOOL_NAME =');
    const end = patched.indexOf('//#endregion', start);
    const parse = runInNewContext(`${patched.slice(start, end)}\ncodeProgram;`);
    const args = { code: 'return "```";', description: 'Inspect namespaces' };
    const cell = { kind: 'tool', inputDetail: JSON.stringify(args), schemaDetail: JSON.stringify({ parameters: { properties: { code: { description: 'The async TypeScript/JavaScript function body to execute.' } } } }) };
    for (const toolName of ['tools_run_code', 'run_code']) {
        const program = parse({ ...cell, toolName });
        assert.equal(program.source, args.code);
        assert.equal(program.rawInput, cell.inputDetail);
        assert.equal(program.description, args.description);
        assert.equal(program.language, 'typescript');
    }
    assert.equal(parse({ ...cell, toolName: 'ordinary_tool' }), undefined);
    assert.equal(parse({ ...cell, toolName: 'tools_run_code', inputDetail: '{}' }), undefined);
    assert(patched.includes('`${cell.toolName} · ${program.description'));
    assert(patched.includes('const program = isCodeTool(cell.toolName);'));
});
