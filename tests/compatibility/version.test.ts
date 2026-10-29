import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationFor, apiGeneration, dshVersion } from '../../src/compatibility/version.js';
import { dshCompatibility } from '../../src/compatibility/compatibility.js';

for (const version of ['0.2.1-rc.2', '0.2.1', '0.2.2-alpha.1']) {
    test(`DSH ${version} selects the legacy API`, () => assert.equal(generationFor(version), 'legacy'));
}

for (const version of ['0.2.2-alpha.2', '0.2.2-alpha.10', '0.2.2-beta.1', '0.2.2', '0.2.10', '1.0.0', 'v0.2.2-alpha.2+build.1']) {
    test(`DSH ${version} selects the executor API`, () => assert.equal(generationFor(version), 'executor'));
}

for (const version of ['0.2.1-rc.1', '0.2.0', 'invalid', '']) {
    test(`unsupported DSH version ${JSON.stringify(version)} fails explicitly`, () => assert.throws(() => generationFor(version), /Unsupported DSH version/));
}

test('the installed host adapter provides schema declarations and structured program errors', () => {
    assert.equal(apiGeneration, generationFor(dshVersion));
    assert.equal(dshCompatibility.jsonSchemaToTs({ type: 'string' }), 'string');
    assert.equal(dshCompatibility.jsonSchemaToTs({ type: 'array', items: { type: 'number' } }), 'number[]');
    const error = new dshCompatibility.CodeRunFailedError('program failed');
    assert.equal(error.message, 'program failed');
    assert.equal((error as Error & { code: string }).code, 'CODE_RUN_FAILED');
});
