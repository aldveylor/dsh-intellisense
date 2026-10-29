import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Version } from '../../src/compatibility/version.js';
import { dshCompatibility } from '../../src/compatibility/compatibility.js';

for (const [value, expected] of [
    ['0.2.1-rc.2', false], ['0.2.1', false], ['0.2.2-alpha.1', false],
    ['0.2.2-alpha.2', true], ['0.2.2-alpha.10', true], ['0.2.2-beta.1', true],
    ['0.2.2', true], ['0.2.10', true], ['1.0.0', true], ['v0.2.2-alpha.2+build.1', true],
] as const) {
    test(`version ${value} compares against the executor boundary`, () => {
        const version = new Version(value);
        assert.equal(version.gte('0.2.2-alpha.2', () => true), expected ? true : undefined);
        assert.equal(version.lt('0.2.2-alpha.2', () => true), expected ? undefined : true);
    });
}

for (const value of ['invalid', '', '0.2']) {
    test(`invalid version ${JSON.stringify(value)} fails explicitly`, () => assert.throws(() => new Version(value), /Invalid version/));
}

test('comparisons return generic callback values and skip unmatched callbacks', async () => {
    const version = new Version('1.2.3');
    const result = { selected: true };
    assert.equal(version.gte('1.2.3', () => result), result);
    assert.equal(version.gt('1.2.2', () => 0), 0);
    assert.equal(version.lte('1.2.3', () => false), false);
    assert.equal(version.lt('1.2.4', () => null), null);
    assert.equal(version.eq('1.2.3+build.1', () => 'equal'), 'equal');
    const pending = Promise.resolve(result);
    assert.equal(version.neq('1.2.4', () => pending), pending);
    assert.equal(await version.gte('1.0.0', async () => result), result);
    for (const [method, target] of [
        ['gte', '1.2.4'], ['gt', '1.2.3'], ['lte', '1.2.2'],
        ['lt', '1.2.3'], ['eq', '1.2.4'], ['neq', '1.2.3'],
    ] as const) {
        assert.equal(version[method](target, () => { throw new Error('unmatched callback ran'); }), undefined);
    }
    const error = new Error('selected callback failed');
    assert.throws(() => version.eq('1.2.3', () => { throw error; }), candidate => candidate === error);
    await assert.rejects(version.eq('1.2.3', async () => { throw error; })!, candidate => candidate === error);
});

test('the installed host adapter provides schema declarations and structured program errors', () => {
    assert.equal(dshCompatibility.jsonSchemaToTs({ type: 'string' }), 'string');
    assert.equal(dshCompatibility.jsonSchemaToTs({ type: 'array', items: { type: 'number' } }), 'number[]');
    const error = new dshCompatibility.CodeRunFailedError('program failed');
    assert.equal(error.message, 'program failed');
    assert.equal((error as Error & { code: string }).code, 'CODE_RUN_FAILED');
});
