import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reports = join(root, 'build/compatibility');
const legacy = join(reports, 'legacy');
const tests = [
    'tests/compatibility/version.test.ts',
    'tests/integration/integration.test.ts',
    'tests/integration/ptc_runtime.test.ts',
    'tests/integration/presentation_scope.test.ts',
    'tests/integration/profile_inheritance.test.ts',
    'tests/namespace/output_schema.test.ts',
];
mkdirSync(legacy, { recursive: true });

/** @brief Keep test output in build and surface the exact failed check. */
function run(command, args, cwd, report) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    writeFileSync(join(reports, report), (result.stdout ?? '') + (result.stderr ?? ''));
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${report} failed; see ${join(reports, report)}`);
}

run(process.execPath, ['scripts/build.mjs'], root, 'build.log');
run(process.execPath, ['--import', 'tsx', '--test', ...tests], root, 'executor_tests.log');

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
manifest.name = 'dsh-compatibility-legacy-fixture';
manifest.private = true;
manifest.scripts = {};
manifest.devDependencies = { ...manifest.devDependencies, ...manifest.peerDependencies };
delete manifest.peerDependencies;
delete manifest.peerDependenciesMeta;
for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-tool-executor-')) delete manifest.devDependencies[name];
    else if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = '0.2.1-rc.2';
}
manifest.devDependencies['@deepseek-ai/cordis'] = '4.0.5';
writeFileSync(join(legacy, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const directory of ['src', 'tests', 'dist', 'presets', 'assets', 'locale', 'docs']) {
    cpSync(join(root, directory), join(legacy, directory), { recursive: true });
}
writeFileSync(join(legacy, 'block_modern.mjs'), `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/dsh-tool-executor-') || specifier === '@deepseek-ai/dsh-tools/pipeline') {
        throw new Error('Legacy host must not import ' + specifier);
    }
    return nextResolve(specifier, context);
} });
`);
run('pnpm', ['install', '--ignore-scripts'], legacy, 'legacy_install.log');
run(process.execPath, ['--import', './block_modern.mjs', '--import', 'tsx', '--test', ...tests], legacy, 'legacy_tests.log');
run(process.execPath, ['--import', './block_modern.mjs', '--input-type=module', '-e', "await import('./dist/index.js');"], legacy, 'legacy_compiled_import.log');
console.log(`DSH compatibility verified for both API generations. Reports: ${reports}`);
