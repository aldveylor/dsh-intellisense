import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { runConversation } from '../../src/protocol/controller.js';
import { processMarkers, mergeContinuation } from '../../src/protocol/markers.js';

const initial: GenerateOptions = { provider: 'mock', model: 'test', messages: [createUserMessage({ content: [{ type: 'text', text: 'read' }], source: { kind: 'user' } })] };
const completion = { candidates: [], signatures: [], context: 'IntelliSense:\n<!> std.fs.read(args: { path: string }): Promise<string>' };
/** @brief Simulate a model that voluntarily finishes after a marker, with split token delivery. */
async function* stream(text: string, finish = true): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: text.slice(0, 5) };
    yield { type: 'text-delta', index: 0, text: text.slice(5) };
    yield { type: 'finish', reason: finish ? { kind: 'stop' } : { kind: 'max-tokens' } };
}

test('completion waits for stream finish, reconstructs non-user context and executes only once', async () => {
    const requests: GenerateOptions[] = []; const executions: string[] = []; const journals: unknown[] = [];
    const response = await runConversation({
        generate: options => { requests.push(options); return stream(requests.length === 1 ? 'await std.fs.<|INTELLISENSE|>' : 'read({path: "a"})'); },
        complete: async source => { assert.equal(source, 'await std.fs.'); return completion; },
        execute: async (_id, source) => { executions.push(source); return { output: 'file', declarations: [] }; },
        journal: async record => { journals.push(record); },
    }, initial, 'once');
    assert.equal(response.source, 'await std.fs.read({path: "a"})');
    assert.equal(executions.length, 1); assert.equal(requests.length, 2); assert.equal(journals.length, 2);
    assert.equal(requests[1]!.messages.filter(m => m.role === 'user').length, 1);
    assert.equal(requests[1]!.messages.at(-2)!.role, 'system');
    assert.equal(requests[1]!.messages.at(-1)!.role, 'assistant');
    assert.deepEqual(requests[1]!.tools, []);
});

test('break and exhausted generation never execute incomplete buffered input', async () => {
    let executed = false;
    const host = { generate: () => stream('const x = <|BREAK|>'), complete: async () => completion, execute: async () => { executed = true; return { output: '', declarations: [] }; }, journal: async () => {} };
    assert.equal((await runConversation(host, initial, 'x')).abandoned, true);
    await assert.rejects(runConversation({ ...host, generate: () => stream('await std.', false) }, initial, 'y'), /not finish normally/);
    assert.equal(executed, false);
});

test('line breaks buffer input; repeated prefixes merge without duplicate execution', async () => {
    let calls = 0;
    const response = await runConversation({
        generate: () => stream(++calls === 1 ? 'const x =<|LINE_BREAK|>' : '3; x'),
        complete: async () => completion, execute: async (_id, source) => { assert.equal(source, 'const x =\n3; x'); return { output: '3', declarations: [] }; }, journal: async () => {},
    }, initial, 'x');
    assert.equal(response.output, '3');
    assert.equal(mergeContinuation('await std.fs.', 'await std.fs.read({})'), 'await std.fs.read({})');
    assert.throws(() => processMarkers('await std.<|INTELLISENSE|>read()'), /stop immediately/);
});
