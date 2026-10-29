import { namespace } from '../namespace/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeConfig, RuntimeHost } from '../../src/runtime/host.js';
import { HostMessage, WorkerMessage } from '../../src/runtime/protocol.js';
import { verifySandbox } from '../../src/runtime/sandbox.js';

const signal = () => new AbortController().signal;
const unused = async () => null;

/** @brief Compile actual command contracts for guest-to-native argument conversion. */
function binding(path: string) {
    const fields = path === 'std.call' ? ['path', 'optional', 'nullable', 'options'] : path === 'std.read' ? ['path'] : [];
    return namespace([{ path, tool: path.slice(4), doc: '', schema: { type: 'object', properties: Object.fromEntries(fields.map(name => [name, {}])), additionalProperties: false }, output: {} }]).commands().find(node => node.path === path)!.binding();
}

test('Node permissions initialize and runtime configuration rejects unknown fields', () => {
    assert.equal(RuntimeConfig.safeParse({ unknownOption: true }).success, false);
    assert.doesNotThrow(() => verifySandbox());
});

test('strict async executions share globalThis within a conversation while keeping local declarations scoped', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const first = await host.execute('session', 'one', `
            const local: number=3; var count=4;
            globalThis.saved={count}; globalThis.increment=()=>++globalThis.saved.count;
            globalThis.read=std.read;
            console.log("%s=%d", "count",count); return local;
        `, [binding('std.read')], unused, signal());
        assert.equal(first.value, 3); assert.deepEqual(first.logs, ['count=4']);
        const second = await host.execute('session', 'two', `
            return [typeof local,typeof count,typeof globalThis,increment(),await read("saved"),typeof std,
                tools.profile.annotation];
        `, [], async () => 'current invocation', signal(), { 'tools.profile.annotation': 'updated' });
        assert.equal(second.error, undefined);
        assert.deepEqual(second.value, ['undefined', 'undefined', 'object', 5, 'current invocation', 'undefined', 'updated']);
        const separate = await host.execute('other', 'three', 'return [typeof saved,typeof increment];', [], unused, signal());
        assert.deepEqual(separate.value, ['undefined', 'undefined']);
        await host.release('session');
        const released = await host.execute('session', 'four', 'return typeof saved;', [], unused, signal());
        assert.equal(released.value, 'undefined');
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
        const bridge = await host.execute('isolation', 'three', 'return Object.getPrototypeOf(std.read) === null;', [binding('std.read')], unused, signal());
        assert.equal(bridge.value, true);
    } finally { await host.dispose(); }
});

test('RPC values and rejections cross IPC without exposing host objects', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const calls: unknown[] = [];
        const result = await host.execute('rpc', 'one', 'return await std.read("a");', [binding('std.read')], async (path, args) => { calls.push([path, args]); return { text: 'contents' }; }, signal());
        assert.deepEqual(result.value, { text: 'contents' });
        assert.deepEqual(calls, [['read', { path: 'a' }]]);
        const denied = await host.execute('rpc', 'two', 'try{await std.read({})}catch(error){return error.message}', [binding('std.read')], async () => { throw new Error('Denied 原文'); }, signal());
        assert.equal(denied.value, 'Denied 原文');
    } finally { await host.dispose(); }
});

test('guest command wrappers update readonly command counts locally without extra RPC', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    const values = { 'tools.profile.tools': [{ name: 'read', brief: 'Read', totalCalls: 8 }] };
    const calls: unknown[] = [];
    try {
        const read = binding('std.read');
        const result = await host.execute('statistics', 'one', `
            const commands=tools.profile.tools, row=commands[0];
            const before=row.totalCalls;
            const pending=std.read("a");
            const immediate=row.totalCalls;
            await pending;
            await Promise.all([std.read("b"),other.read("c")]);
            try{await std.read("denied")}catch{}
            try{await std.read("a","extra")}catch{}
            let readonly=false;
            try{row.totalCalls=900}catch{readonly=true}
            return [before,immediate,row.totalCalls,tools.profile.tools[0].totalCalls,readonly,Object.isFrozen(commands),Object.isFrozen(row)];
        `, [read, { ...read, path: 'other.read' }], async (tool, args) => {
            calls.push([tool, args]);
            if ((args as { path: string }).path === 'denied') throw new Error('Denied');
            return null;
        }, signal(), values);
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, [8, 9, 12, 12, true, true, true]);
        assert.equal(calls.length, 4);
        assert.equal(values['tools.profile.tools'][0]!.totalCalls, 8);
        const next = await host.execute('statistics', 'two', 'return tools.profile.tools[0].totalCalls;', [read], unused, signal(), {
            'tools.profile.tools': [{ name: 'read', brief: 'Read', totalCalls: 42 }],
        });
        assert.equal(next.value, 42);
    } finally { await host.dispose(); }
});

test('timeout and cancellation terminate a process, abort pending RPC and advance epoch', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000, syncTimeoutMs: 50 });
    try {
        const timeout = await host.execute('timeout', 'one', 'globalThis.stale=1;while(true){}', [], unused, signal());
        assert(timeout.error?.includes('timed out'));
        const next = await host.execute('timeout', 'two', 'return typeof stale;', [], unused, signal());
        assert.equal(next.epoch, 2); assert.equal(next.value, 'undefined');
        const controller = new AbortController();
        let started: () => void = () => {};
        let rpcSignal: AbortSignal | undefined;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const run = host.execute('abort', 'one', 'return await std.wait();', [binding('std.wait')], async (_path, _args, abort) => {
            rpcSignal = abort; started();
            return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason), { once: true }));
        }, controller.signal);
        await ready; controller.abort();
        await assert.rejects(run, /cancelled/);
        assert(rpcSignal?.aborted);
        assert.equal(host.epoch('abort'), 2);
    } finally { await host.dispose(); }
});

test('cancellation during worker startup rejects cleanly and permits a fresh execution', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        for (let index = 0; index < 3; index++) {
            await assert.rejects(host.execute('startup', `cancel-${index}`, 'return 1;', [], unused, AbortSignal.timeout(10)), /cancelled/);
            const next = await host.execute('startup', `retry-${index}`, 'return 42;', [], unused, signal());
            assert.equal(next.error, undefined);
            assert.equal(next.value, 42);
            await host.release('startup');
        }
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

test('positional RPC preserves optional holes, explicit null and undefined results across realms', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const received: unknown[] = [];
        const result = await host.execute('positional', 'one', 'return [await std.call("x",undefined,null,{nested:true}),typeof await std.empty()];', [binding('std.call'), binding('std.empty')], async (path, args) => {
            received.push([path, args]);
            return path === 'call' ? 'ok' : undefined;
        }, signal());
        assert.deepEqual(result.value, ['ok', 'undefined']);
        assert.deepEqual(received, [['call', { path: 'x', nullable: null, options: { nested: true } }], ['empty', {}]]);
    } finally { await host.dispose(); }
});


test('program settlement drains parallel RPC without cancelling siblings or resetting the process', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const cases = [
            { code: 'void std.read("slow"); return 42;', value: 42 },
            { code: 'return await Promise.all([std.read("fail"), std.read("slow")]);', error: true },
            { code: 'try { await Promise.all([std.read("fail"), std.read("slow")]); } catch {} return await std.read("next");', value: 'next' },
        ];
        for (const [index, item] of cases.entries()) {
            let completed = false;
            const result = await host.execute('siblings', `run-${index}`, item.code, [binding('std.read')], async (_tool, input, signal) => {
                const { path } = input as { path: string };
                if (path === 'fail') throw new Error('Expected child failure');
                if (path === 'slow') {
                    await new Promise(resolve => setTimeout(resolve, 40));
                    assert.equal(signal.aborted, false);
                    completed = true;
                }
                return path;
            }, signal());
            assert.equal(completed, true);
            assert.equal(result.epoch, 1);
            if (item.error) assert.match(result.error!, /Expected child failure/);
            else { assert.equal(result.error, undefined); assert.equal(result.value, item.value); }
        }
        const next = await host.execute('siblings', 'after', 'return 7;', [], unused, signal());
        assert.equal(next.value, 7);
        assert.equal(next.epoch, 1);
    } finally { await host.dispose(); }
});

test('execution deadline still cancels RPC while draining after an early return', async () => {
    const host = new RuntimeHost({ timeoutMs: 500 });
    try {
        let cancelled = false;
        await assert.rejects(host.execute('drain-timeout', 'one', 'void std.read("slow"); return 42;', [binding('std.read')], async (_tool, _input, signal) => {
            await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
            return null;
        }, signal()), /timed out/);
        assert.equal(cancelled, true);
        const next = await host.execute('drain-timeout', 'two', 'return 42;', [], unused, signal());
        assert.equal(next.value, 42);
        assert.equal(next.epoch, 2);
    } finally { await host.dispose(); }
});


test('program return values use JSON serialization for nested void values and sparse arrays', async () => {
    const host = new RuntimeHost({ timeoutMs: 3000 });
    try {
        const result = await host.execute('json-result', 'nested', `
            return { rows: [{ ok: true, value: undefined }, { value: null }],
                values: [undefined, , null], missing: undefined };
        `, [], unused, signal());
        assert.equal(result.error, undefined);
        assert.deepEqual(result.value, { rows: [{ ok: true }, { value: null }], values: [null, null, null] });
        const empty = await host.execute('json-result', 'empty', 'return undefined;', [], unused, signal());
        assert.equal(empty.error, undefined);
        assert.equal(empty.value, undefined);
        for (const [index, code] of ['return 1n;', 'const cycle = {}; cycle.self = cycle; return cycle;'].entries()) {
            const invalid = await host.execute('json-result', `invalid-${index}`, code, [], unused, signal());
            assert.match(invalid.error!, /Cannot serialize program return value as JSON/);
        }
    } finally { await host.dispose(); }
});
