import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeHost } from '../../src/runtime_host/host.js';
import { HostMessage, WorkerMessage } from '../../src/runtime_host/protocol.js';

const signal = () => new AbortController().signal;
const unused = async () => null;

test('strict AsyncFunction keeps only explicit globalThis state, supports TS and native console', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const first = await host.execute('session', 'one', 'const local: number=3; globalThis.count=4; console.log("%s=%d", "count",globalThis.count); return local;', [], unused, signal());
        assert.equal(first.value, 3); assert.deepEqual(first.logs, ['count=4']);
        const second = await host.execute('session', 'two', 'return [typeof local,globalThis.count];', [], unused, signal());
        assert.deepEqual(second.value, ['undefined', 4]);
        const separate = await host.execute('other', 'three', 'return typeof globalThis.count;', [], unused, signal());
        assert.equal(separate.value, 'undefined');
    } finally { await host.dispose(); }
});

test('A12: no modules, process binding or constructor escape is exposed inside the VM', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const result = await host.execute('isolation', 'one', `
            const rejected=[];
            for(const attempt of [()=>require("fs"),()=>require("child_process"),()=>require("net"),()=>process.binding("fs"),()=>console.log.constructor("return process")()]){
                try{attempt(); rejected.push(false)}catch(error){rejected.push(true)}
            }
            return [typeof process,typeof require,typeof fetch,...rejected];`, [], unused, signal());
        assert.deepEqual(result.value, ['undefined', 'undefined', 'undefined', true, true, true, true, true]);
        const direct = await host.execute('isolation', 'two', 'return await import("node:fs");', [], unused, signal());
        assert(direct.error);
        const bridge = await host.execute('isolation', 'three', 'return Object.getPrototypeOf(std.read) === null;', ['std.read'], unused, signal());
        assert.equal(bridge.value, true);
    } finally { await host.dispose(); }
});

test('RPC values and rejections cross IPC without exposing host objects', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const calls: unknown[] = [];
        const result = await host.execute('rpc', 'one', 'return await std.read({path:"a"});', ['std.read'], async (path, args) => { calls.push([path, args]); return { text: 'contents' }; }, signal());
        assert.deepEqual(result.value, { text: 'contents' });
        assert.deepEqual(calls, [['std.read', { path: 'a' }]]);
        const denied = await host.execute('rpc', 'two', 'try{await std.read({})}catch(error){return error.message}', ['std.read'], async () => { throw new Error('Denied 原文'); }, signal());
        assert.equal(denied.value, 'Denied 原文');
    } finally { await host.dispose(); }
});

test('timeout and cancellation terminate a process, abort pending RPC and advance epoch', async () => {
    const host = new RuntimeHost({ timeoutMs: 250, syncTimeoutMs: 50 });
    try {
        const timeout = await host.execute('timeout', 'one', 'globalThis.stale=1;while(true){}', [], unused, signal());
        assert(timeout.error?.includes('timed out'));
        const next = await host.execute('timeout', 'two', 'return typeof globalThis.stale;', [], unused, signal());
        assert.equal(next.epoch, 2); assert.equal(next.value, 'undefined');
        const controller = new AbortController();
        let started: () => void = () => {};
        let rpcSignal: AbortSignal | undefined;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const run = host.execute('abort', 'one', 'return await std.wait({});', ['std.wait'], async (_path, _args, abort) => {
            rpcSignal = abort; started();
            return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason), { once: true }));
        }, controller.signal);
        await ready; controller.abort();
        await assert.rejects(run, /cancelled/);
        assert(rpcSignal?.aborted);
        assert.equal(host.epoch('abort'), 2);
    } finally { await host.dispose(); }
});

test('A10: disposal rejects pending work and prevents any future runtime launch', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    const first = await host.execute('dispose', 'one', 'return 1;', [], unused, signal());
    assert.equal(first.value, 1);
    await host.dispose();
    await assert.rejects(host.execute('dispose', 'two', 'return 2;', [], unused, signal()), /disposed/);
});

test('IPC schemas reject unknown fields and callbacks', () => {
    assert(!HostMessage.safeParse({ type: 'execute', id: 1, execution: 'a', javascript: 'return 1', callback: () => {} }).success);
    assert(!WorkerMessage.safeParse({ type: 'call', id: 1, execution: 'a', path: 'std.read', args: () => {} }).success);
});
