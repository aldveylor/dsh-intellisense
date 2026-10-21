import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { runConversation } from '../../src/protocol/controller.js';
import { ExecutionTrace } from '../../src/dsh/execution_trace.js';

/** @brief Emit exact generated segments, including terminal lookup markers. */
async function* generation(text: string): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: text.slice(0, 5) };
    yield { type: 'text-delta', index: 0, text: text.slice(5) };
    yield { type: 'finish', reason: { kind: 'stop' } };
}

test('codes keeps every generated segment and each IntelliSense query has its full paired result', async () => {
    const events: Array<{ type: string; data: any; seq: number }> = [];
    const agent = { session: { append: (type: string, data: unknown) => {
        const event = { type, data, seq: events.length + 1 }; events.push(event); return event;
    } } } as unknown as Agent;
    const options: GenerateOptions = { provider: 'mock', model: 'test', messages: [] };
    const trace = new ExecutionTrace(agent, { turn: 1, step: 1 }, options);
    const codes = ['std.fs.read<|INTELLISENSE|>', '({path: "a"})'];
    let round = 0;
    const completion = { candidates: [], signatures: ['read(args: {path: string}): Promise<string>'], context: 'Full parameter documentation' };
    const response = await runConversation({
        generate: () => generation(codes[round++]!), code: (index, code) => trace.updateCode(index, code),
        intellisense: record => trace.intellisense(record), complete: async () => completion,
        execute: async (_id, source) => { assert.equal(source, 'std.fs.read({path: "a"})'); trace.begin(); return { output: 'contents', declarations: [] }; },
        journal: async () => {},
    }, options, 'records');
    trace.finish(response.output);
    const assistant = events.find(event => event.type === 'assistant/message')!;
    assert.deepEqual(JSON.parse(assistant.data.message.content[0].arguments), { codes });
    const starts = events.filter(event => event.type === 'tool/ptc-dispatch-start');
    const results = events.filter(event => event.type === 'tool/ptc-dispatch');
    assert.equal(starts.length, 1); assert.equal(results.length, 1);
    assert.equal(starts[0]!.data.name, 'INTELLISENSE');
    assert.deepEqual(starts[0]!.data.arguments, { code: 'std.fs.read' });
    assert.equal(starts[0]!.data.subCallId, results[0]!.data.subCallId);
    assert.deepEqual(JSON.parse(results[0]!.data.content[0].text), completion);
    assert(events.find(event => event.type === 'tool/call')!.seq < starts[0]!.seq);
    assert.deepEqual(events.find(event => event.type === 'tool/result')!.data.meta.codes, codes);
    const replay: string[] = [];
    for (const event of events.filter(event => event.type === 'ts-repl/source')) {
        const { index, offset, text } = event.data;
        replay[index] = (replay[index] ?? '').slice(0, offset) + text;
    }
    assert.deepEqual(replay, codes);
});

test('repeated lookup records include cached results and the terminal rejection without repeating the query', async () => {
    const records: any[] = [];
    const completion = { candidates: [], signatures: ['read(args: {}): Promise<string>'], context: 'known members' };
    let queries = 0;
    await assert.rejects(runConversation({
        generate: () => generation('std.fs.<|INTELLISENSE|>'),
        intellisense: record => records.push(record),
        complete: async () => { queries++; return completion; },
        execute: async () => { throw new Error('Must not execute'); },
        journal: async () => {},
    }, { provider: 'mock', model: 'test', messages: [] }, 'repeated-records'), /three times/);
    assert.equal(queries, 1);
    assert.equal(records.length, 6);
    assert.deepEqual(records.filter(record => record.phase === 'request').map(record => record.round), [0, 1, 2]);
    const results = records.filter(record => record.phase === 'result');
    assert.deepEqual(results[0].result, completion);
    assert.deepEqual(results[1].result, completion);
    assert.equal(results[1].reused, true);
    assert.match(results[2].error, /three times/);
});
