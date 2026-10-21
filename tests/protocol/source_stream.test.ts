import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { runConversation } from '../../src/protocol/controller.js';
import { previewSource } from '../../src/protocol/markers.js';

const initial: GenerateOptions = { provider: 'mock', model: 'test', messages: [] };

/** @brief Deliver source fragments independently from stream settlement. */
async function* fragments(parts: string[]): AsyncIterable<StreamChunk> {
    for (const text of parts) yield { type: 'text-delta', index: 0, text };
    yield { type: 'finish', reason: { kind: 'stop' } };
}

test('source preview withholds split markers and Markdown fences', () => {
    assert.equal(previewSource('', 'unknown.<'), 'unknown.');
    assert.equal(previewSource('', 'unknown.<|INTEL'), 'unknown.');
    assert.equal(previewSource('', 'unknown.<|INTELLISENSE|>'), 'unknown.');
    assert.equal(previewSource('', '```typescript\nconst value = 1;\n```'), 'const value = 1;');
});

test('source streaming joins continuation and replaces rejected programs before executing once', async () => {
    const rounds = [
        ['await unknown.', '<', '|INTELLISENSE', '|>'],
        ['read(', '{path: "a"})'],
        ['"Final ', 'reply"'],
    ];
    const previews: string[] = [];
    const executed: string[] = [];
    let validations = 0;
    const response = await runConversation({
        generate: () => fragments(rounds.shift()!), source: source => previews.push(source),
        complete: async source => { assert.equal(source, 'await unknown.'); return { candidates: [], signatures: [], context: 'read is available' }; },
        validate: async () => ++validations === 1 ? 'Rewrite the program' : undefined,
        execute: async (_id, source) => { executed.push(source); return { output: 'Final reply', declarations: [] }; },
        journal: async () => {},
    }, initial, 'source-stream');
    assert(previews.includes('await unknown.read('));
    assert(previews.includes('await unknown.read({path: "a"})'));
    assert(previews.includes(''));
    assert(previews.every(source => !source.includes('<|') && !source.endsWith('<')));
    assert.deepEqual(executed, ['"Final reply"']);
    assert.equal(response.output, 'Final reply');
    assert.equal(previews.at(-1), '"Final reply"');
});
