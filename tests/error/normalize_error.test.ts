import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { normalizeError, UnknownError, ProfilePermissionError } from '../../src/error.js';


test('normalization leaves short errors and schema failures unchanged', () => {
    const ordinary = new ProfilePermissionError('Protected node cannot be removed: tools');
    assert.equal(normalizeError(ordinary), ordinary);
    assert.equal(ordinary.message, 'Protected node cannot be removed: tools');
    const parsed = z.string().safeParse(1);
    assert(!parsed.success);
    const message = parsed.error.message;
    assert.equal(normalizeError(parsed.error), parsed.error);
    assert.equal(parsed.error.message, message);
    assert.equal(normalizeError(new Error('a'.repeat(1000))).message.length, 1000);
});

test('long Zod failures retain their type, original issues and nested field paths', () => {
    const parsed = z.object({ root: z.object({ fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]) }) }).safeParse({ root: { fixedLevel: 9 } });
    assert(!parsed.success);
    assert(parsed.error.message.length > 1000);
    const issues = parsed.error.issues;
    const simplified = normalizeError(parsed.error);
    assert.equal(simplified, parsed.error);
    assert(simplified instanceof z.ZodError);
    assert.equal(simplified.issues, issues);
    assert.deepEqual(JSON.parse(simplified.message), { type: 'ZodError', issues: [{ path: 'root.fixedLevel', message: 'Expected one of: 0, 1, 2, 3, 4, 5, 6, 7' }] });
    assert.throws(() => { throw simplified; }, z.ZodError);
});

test('unknown thrown values become UnknownError and long ordinary errors retain their subclass', () => {
    const unknown = normalizeError('Unexpected value');
    assert(unknown instanceof UnknownError);
    assert.equal(unknown.message, 'Unexpected value');
    const original = new ProfilePermissionError('x'.repeat(2000));
    const simplified = normalizeError(original);
    assert.equal(simplified, original);
    assert(simplified instanceof ProfilePermissionError);
    assert.equal(simplified.code, 'profile_permission_denied');
    assert(simplified.message.length < 1000);
});
