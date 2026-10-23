import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../../src/runtime/session.js';
import { IsolatedSession } from '../../src/runtime/isolated.js';
import { complete } from '../../src/typescript/completion.js';
import { environmentPrompt } from '../../src/protocol/prompt.js';
import { runConversation } from '../../src/protocol/controller.js';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';

/** @brief A minimal environment for native-console and VM lifecycle behavior. */
const environment = { declarations: '', paths: [] };

test('native Console formats values, captures stderr and exposes no vm.print', async () => {
    const runtime = new SessionRuntime(async () => null);
    try {
        runtime.update(environment);
        const result = await runtime.execute('format', 'console.log("%s=%d", "value", 3); console.warn("warning %s", "detail"); console.error("错误原文")');
        assert.deepEqual(result.prints, ['value=3', 'warning detail', '错误原文']);
        assert.equal(result.error, undefined);
        assert.equal(result.output, '');
        assert(!runtime.members('vm')?.includes('print'));
        assert(runtime.validate('vm.print(1)')?.includes("Property 'print' does not exist"));
        const methods = complete(runtime, environment, 'console.').candidates.map(candidate => candidate.name);
        for (const method of ['log', 'warn', 'error', 'table', 'time']) assert(methods.includes(method));
        assert(!complete(runtime, environment, 'vm.').candidates.some(candidate => candidate.name === 'print'));
    } finally { runtime.dispose(); }
});

test('console timers, counters and output survive ordinary executions and reinstall on restart', async () => {
    const runtime = new SessionRuntime(async () => null);
    try {
        runtime.update(environment);
        const first = await runtime.execute('first', 'let retained = 3; console.count("calls"); console.time("timer");');
        assert.deepEqual(first.prints, ['calls: 1']);
        const second = await runtime.execute('second', 'console.count("calls"); console.timeEnd("timer");');
        assert.equal(second.prints?.[0], 'calls: 2');
        assert.match(second.prints?.[1] ?? '', /^timer: /);
        const reset = await runtime.execute('reset', 'vm.restart(["retained"])');
        assert.equal(reset.restarted, true);
        const next = await runtime.execute('next', 'console.log("retained=%d", retained); console.count("calls");');
        assert.deepEqual(next.prints, ['retained=3', 'calls: 1']);
        assert(!runtime.members('vm')?.includes('print'));
        assert.throws(() => runtime.update({ declarations: '', paths: ['console.log'] }), /reserved/);
    } finally { runtime.dispose(); }
});

test('native VM exception text passes through unchanged without an English-only runtime restriction', async () => {
    const runtime = new SessionRuntime(async () => null);
    try {
        const result = await runtime.execute('error', 'throw new Error("错误原文：路径不存在");');
        assert.equal(result.error, '错误原文：路径不存在');
        assert.equal((await runtime.execute('unicode', 'console.log("用户数据");')).prints?.[0], '用户数据');
    } finally { runtime.dispose(); }
});

test('isolated worker returns native Console output over IPC', { timeout: 15_000 }, async () => {
    const runtime = new IsolatedSession(async () => null, 10_000);
    try {
        await runtime.update(environment);
        const result = await runtime.execute('ipc', 'console.log("native %s", "output"); console.error("detail");');
        assert.deepEqual(result.prints, ['native output', 'detail']);
        assert.equal(result.error, undefined);
    } finally { runtime.dispose(); }
});

test('controller feeds console output back to the agent without obsolete print instructions', async () => {
    const runtime = new SessionRuntime(async () => null);
    try {
        const requests: GenerateOptions[] = [];
        const segments = ['console.log("value=%d", 4)', '"finished"'];
        const result = await runConversation({
            generate: options => {
                requests.push(options);
                return (async function* (): AsyncIterable<StreamChunk> {
                    yield { type: 'text-delta', index: 0, text: segments[requests.length - 1]! };
                    yield { type: 'finish', reason: { kind: 'stop' } };
                })();
            },
            execute: (id, source) => runtime.execute(id, source),
            complete: async () => ({ candidates: [], signatures: [], context: '' }),
            journal: async () => {},
        }, { provider: 'fake', model: 'scripted', messages: [] }, 'console-feedback');
        assert.equal(result.output, 'finished');
        const feedback = JSON.stringify(requests[1]!.messages);
        assert(feedback.includes('console output: value=4'));
        assert(!feedback.includes('vm.print'));
        const prompt = environmentPrompt([], 'Current session');
        assert(!prompt.includes('vm.print'));
        assert(prompt.includes('console.log'));
    } finally { runtime.dispose(); }
});
