import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IsolatedSession } from '../../src/runtime/isolated.js';

const unavailable = async (): Promise<never> => { throw new Error('Denied'); };
test('process-backed VM preserves lexical bindings and crosses only the tool bridge', async () => {
    const calls: unknown[] = [];
    const runtime = new IsolatedSession(async (path, args) => { calls.push([path, args]); return { value: 42 }; }, unavailable, 10_000);
    try {
        await runtime.update({ declarations: 'declare const std: { read(args: { path: string }): Promise<{ value: number }> };', paths: ['std.read'] });
        assert.equal((await runtime.execute('a', 'const answer = await std.read({path: "a"}); answer.value')).output, '42');
        assert.equal((await runtime.execute('b', '(globalThis as any).answer')).output, '');
        assert.equal((await runtime.execute('c', 'answer.value')).output, '42');
        assert.equal(calls.length, 1);
        const checkpoint = await runtime.checkpoint(); assert.equal(checkpoint.version, 1);
    } finally { runtime.dispose(); }
});

test('VM string code generation is disabled even through type assertions', async () => {
    const runtime = new IsolatedSession(unavailable, unavailable, 10_000);
    try { await assert.rejects(runtime.execute('a', '(Function as any)("return process")()'), /Code generation from strings disallowed/); }
    finally { runtime.dispose(); }
});

test('async CPU hangs terminate the process without hanging the parent', async () => {
    const runtime = new IsolatedSession(unavailable, unavailable, 1500);
    try {
        await runtime.update({ declarations: '', paths: [] });
        await assert.rejects(runtime.execute('a', 'await (async () => { await Promise.resolve(); while (true) {} })()'), /timed out|process exited/);
        await assert.rejects(runtime.execute('a', 'await (async () => { await Promise.resolve(); while (true) {} })()'), /timed out|process exited/);
        await assert.rejects(runtime.execute('b', '1 + 1'), /closed/);
    } finally { runtime.dispose(); }
});


test('even a VM host-realm escape cannot read host credentials or spawn child processes', async () => {
    const runtime = new IsolatedSession(unavailable, unavailable, 10_000);
    try {
        const escaped = '(tools.sort as any).constructor("return process")()';
        await assert.rejects(runtime.execute('read', `${escaped}.getBuiltinModule("node:fs").readFileSync("/etc/passwd", "utf8")`), /Access.*(?:denied|restricted)|not allowed/i);
        await assert.rejects(runtime.execute('spawn', `${escaped}.getBuiltinModule("node:child_process").execSync("true")`), /Access.*(?:denied|restricted)|not allowed/i);
    } finally { runtime.dispose(); }
});
