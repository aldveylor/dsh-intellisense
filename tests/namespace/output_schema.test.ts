import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../../src/output_schema.js';
import { commandDeclaration } from '../../src/profile/namespace/command_contract/command_contract.js';
import { nativeDiscovery } from './fixtures.js';
import { returnTypeDeclaration } from '../../src/web/server/return_type.js';
import { namespace } from './fixtures.js';

test('output projections omit nested descriptions while preserving fields, literals and source schemas', () => {
    const output = {
        type: 'object', description: 'Root return documentation', additionalProperties: false,
        properties: {
            description: { type: 'string', description: 'Field return documentation', const: 'literal description' },
            rows: { type: 'array', items: { oneOf: [
                { type: 'object', properties: { value: { type: 'number', description: 'Nested return documentation' } }, additionalProperties: false },
                { type: 'null', description: 'Null return documentation' },
            ] } },
        },
        required: ['description', 'rows'],
        examples: [{ description: 'Example literal' }],
    };
    const original = structuredClone(output);
    const clean = outputSchema(output) as typeof output;
    assert(!Object.hasOwn(clean, 'description'));
    assert(!Object.hasOwn(clean.properties.description, 'description'));
    assert.equal(clean.properties.description.const, 'literal description');
    assert.deepEqual(clean.examples, output.examples);
    const entry = { path: 'files.inspect', tool: 'inspect', schema: {}, output, doc: 'Inspect files' };
    const native = JSON.parse(nativeDiscovery([entry.path], namespace([entry])));
    assert.deepEqual(native.members[0].output, clean);
    for (const text of [commandDeclaration(entry), returnTypeDeclaration(output), JSON.stringify(clean)]) {
        assert(!text.includes('return documentation'));
        assert(!text.includes('@returns'));
        assert(text.includes('description'));
        assert(text.includes('literal description'));
    }
    assert.deepEqual(output, original);
});
