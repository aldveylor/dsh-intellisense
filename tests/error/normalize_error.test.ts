import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { normalizeError, ZodError, ProfilePermissionError } from '../../src/error.js';


test('conversion translates short schema errors without mutating the original error', () => {
    const parsed = z.string().safeParse(1);
    assert(!parsed.success);
    const message = parsed.error.message;
    const converted = normalizeError(parsed.error);
    assert(converted instanceof ZodError);
    assert.equal(converted.name, 'ZodError');
    assert.equal(parsed.error.message, message);
    assert.deepEqual(JSON.parse(converted.message), { type: 'ZodError', issues: [{ path: '', message: 'Invalid input: expected string, received number' }] });
    assert.throws(() => { throw converted; }, ZodError);
});

test('union conversion retains nested field paths and lists expected values once', () => {
    const parsed = z.object({ root: z.object({ fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]) }) }).safeParse({ root: { fixedLevel: 9 } });
    assert(!parsed.success);
    const converted = normalizeError(parsed.error);
    assert(converted instanceof ZodError);
    assert.deepEqual(converted.issues, [{ path: 'root.fixedLevel', message: 'Expected one of: 0, 1, 2' }]);
    assert.deepEqual(JSON.parse(converted.message), { type: 'ZodError', issues: converted.issues });
});

test('unsupported values and conversion failures return the exact original value', () => {
    const original = new ProfilePermissionError('x'.repeat(2000));
    for (const value of [original, 'Unexpected value', null, undefined, { message: 'Unknown' }]) assert.equal(normalizeError(value), value);
    const malformed = new z.ZodError([{ code: 'invalid_union', path: ['root'], message: 'Malformed union', errors: null } as unknown as z.core.$ZodIssue]);
    assert.equal(normalizeError(malformed), malformed);
});
