import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
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


test('DSML namespace discovery retries as TypeScript and consumes completion markers', async () => {
    const responses = ['<｜DSML｜calls> <|INTELLISENSE|>', 'unknown.<|INTELLISENSE|>', 'read({})'];
    const requests: GenerateOptions[] = [];
    const executions: string[] = [];
    const response = await runConversation({
        generate: options => { requests.push(options); return stream(responses.shift()!); },
        complete: async source => { assert.equal(source, 'unknown.'); return completion; },
        execute: async (_id, source) => { executions.push(source); return { output: 'ok', declarations: [] }; },
        journal: async () => {},
    }, initial, 'dsml');
    assert.equal(response.source, 'unknown.read({})');
    assert.deepEqual(executions, ['unknown.read({})']);
    assert.match(JSON.stringify(requests[1]!.messages), /Invalid response format/);
    assert.equal(requests[1]!.messages.filter(m => m.role === 'user').length, 1);
});

test('native tool-call retries preserve the unexecuted prefix', async () => {
    let calls = 0;
    const response = await runConversation({
        generate: () => {
            calls++;
            if (calls === 2) return (async function* (): AsyncIterable<StreamChunk> {
                yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('bad'), name: 'read', arguments: '{}' } };
                yield { type: 'finish', reason: { kind: 'stop' } };
            })();
            return stream(calls === 1 ? 'await std.fs.<|INTELLISENSE|>' : 'read({})');
        },
        complete: async () => completion,
        execute: async (_id, source) => { assert.equal(source, 'await std.fs.read({})'); return { output: 'ok', declarations: [] }; },
        journal: async () => {},
    }, initial, 'native');
    assert.equal(response.output, 'ok');
    assert.equal(calls, 3);
});

test('repeated DSML output exhausts the retry limit without execution', async () => {
    await assert.rejects(runConversation({
        generate: () => stream('<|DSML|calls> <|INTELLISENSE|>'),
        complete: async () => { assert.fail('invalid protocol must not request completion'); },
        execute: async () => { assert.fail('invalid protocol must not execute'); },
        journal: async () => {},
    }, initial, 'invalid', 2), /correction limit exceeded/);
});


test('session v4 bare marker chunks request completion without an empty assistant prefix', async () => {
    const requests: GenerateOptions[] = [];
    let completions = 0;
    let executions = 0;
    const result = await runConversation({
        generate: request => {
            requests.push(request);
            if (requests.length > 1) return stream('Object.keys(unknown)');
            return (async function* (): AsyncIterable<StreamChunk> {
                yield { type: 'block-start', index: 0, blockType: 'text' };
                // Exact token chunks from build/session.v4.jsonl assistant/message seq 21.
                for (const text of ['<', '|', 'INT', 'ELL', 'IS', 'ENSE', '|', '>']) yield { type: 'text-delta', index: 0, text };
                yield { type: 'block-end', index: 0, block: { type: 'text', text: '<|INTELLISENSE|>' } };
                yield { type: 'finish', reason: { kind: 'stop' } };
            })();
        },
        complete: async source => { assert.equal(source, ''); completions++; return completion; },
        execute: async (_id, source) => { assert.equal(source, 'Object.keys(unknown)'); executions++; return { output: 'names', declarations: [] }; },
        journal: async () => {},
    }, initial, 'session-v4');
    assert.equal(completions, 1);
    assert.equal(executions, 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[1]!.messages.at(-1)!.role, 'system');
    assert.equal(requests[1]!.messages.filter(m => m.role === 'user').length, 1);
    assert(!requests[1]!.messages.some(m => m.role === 'assistant' && m.content.some(b => b.type === 'text' && !b.text)));
    assert.equal(result.output, 'names');
    assert(!result.source.includes('<|INTELLISENSE|>'));
});


test('validation repairs prose and fences before execution while retaining discovery context', async () => {
    const responses = ['<|INTELLISENSE|>', 'unknown 不存在。\n\n```ts\nObject.keys(unknown)\n```', 'Object.keys(unknown)'];
    const requests: GenerateOptions[] = [];
    const validated: string[] = [];
    const executed: string[] = [];
    const response = await runConversation({
        generate: request => { requests.push(request); return stream(responses.shift()!); },
        complete: async () => completion,
        validate: async source => { validated.push(source); return source.startsWith('unknown 不存在') ? 'error TS1434: Unexpected keyword or identifier.' : undefined; },
        execute: async (_id, source) => { executed.push(source); return { output: 'members', declarations: [] }; },
        journal: async () => {},
    }, initial, 'repair');
    assert.equal(validated.length, 2);
    assert(validated[0]!.endsWith('```'));
    assert.deepEqual(executed, ['Object.keys(unknown)']);
    assert.match(JSON.stringify(requests[2]!.messages), /TypeScript validation failed/);
    assert.match(JSON.stringify(requests[2]!.messages), /std.fs.read/);
    assert.equal(response.output, 'members');
});

test('validation retries are bounded and runtime failures never retry executed code', async () => {
    let executions = 0;
    const host = {
        generate: () => stream('bad prose'), complete: async () => completion,
        validate: async () => 'error TS1434',
        execute: async () => { executions++; throw new Error('runtime failure'); },
        journal: async () => {},
    };
    await assert.rejects(runConversation(host, initial, 'invalid', 2), /correction limit/);
    assert.equal(executions, 0);
    await assert.rejects(runConversation({ ...host, validate: async () => undefined }, initial, 'runtime'), /runtime failure/);
    assert.equal(executions, 1);
});


test('text after a control marker is rejected and corrected within the correction limit', async () => {
    const responses = ['unknown.<|INTELLISENSE|> 然后查看成员', 'unknown.<|INTELLISENSE|>', 'read({})'];
    const records: { response: string; context?: string }[] = [];
    const result = await runConversation({
        generate: () => stream(responses.shift()!),
        complete: async source => { assert.equal(source, 'unknown.'); return completion; },
        execute: async (_id, source) => { assert.equal(source, 'unknown.read({})'); return { output: 'ok', declarations: [] }; },
        journal: async record => { records.push(record); },
    }, initial, 'marker-repair');
    assert.match(records[0]!.context!, /Invalid control marker format/);
    assert.equal(result.output, 'ok');
});


test('repeated discovery at the same cursor resets the unexecuted buffer with retained VM context', async () => {
    const responses = ['unknown.<|INTELLISENSE|>', '<|INTELLISENSE|>', 'console.log(Object.keys(unknown))'];
    const requests: GenerateOptions[] = [];
    let completions = 0;
    const result = await runConversation({
        generate: request => { requests.push(request); return stream(responses.shift()!); },
        complete: async () => { completions++; return completion; },
        execute: async (_id, source) => { assert.equal(source, 'console.log(Object.keys(unknown))'); return { output: 'members', declarations: [] }; },
        journal: async () => {},
    }, initial, 'repeat');
    assert.equal(completions, 1);
    assert.match(JSON.stringify(requests[2]!.messages), /same cursor has already been inspected/);
    assert.match(JSON.stringify(requests[2]!.messages), /std.fs.read/);
    assert.equal(result.output, 'members');
});


test('discovery keeps a task-local three-entry deque without limiting successful continuations', async () => {
    const original = JSON.stringify(initial);
    let calls = 0;
    let completions = 0;
    let executions = 0;
    const host = {
        generate: (request: GenerateOptions) => {
            const context = JSON.stringify(request.messages);
            for (let index = 0; index < completions; index++) {
                assert.equal(context.includes(`discovery_${index}_end`), index >= completions - 3);
            }
            calls++;
            return stream(calls <= 15 ? `const value_${calls} = 1;\n<|INTELLISENSE|>` : '"done"');
        },
        complete: async () => ({ ...completion, context: `discovery_${completions++}_end` }),
        validate: async () => undefined,
        execute: async () => { executions++; return { output: 'done', declarations: [] }; },
        journal: async () => {},
    };
    const result = await runConversation(host, initial, 'deque', 2);
    assert.equal(result.output, 'done');
    assert.equal(calls, 16);
    assert.equal(executions, 1);
    assert.equal(JSON.stringify(initial), original);
    await runConversation({
        ...host,
        generate: request => {
            assert(!JSON.stringify(request).includes('discovery_'));
            return stream('"next task"');
        },
    }, initial, 'next-task', 2);
});
