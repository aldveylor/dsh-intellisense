import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../../src/runtime/session.js';
import { IsolatedSession } from '../../src/runtime/isolated.js';
import { validatePath } from '../../src/registry/path.js';
import { complete } from '../../src/typescript/completion.js';

const environment = { declarations: '', paths: [] };

test('fixed print callbacks report values and runtime errors preserve the Context', async () => {
    const runtime = new SessionRuntime(async () => undefined);
    try {
        const first = await runtime.execute('print', 'const value = { count: 3 }; vm.print(value, "ready")');
        assert.deepEqual(first.prints, ['{ count: 3 } ready']);
        assert.equal(first.output, '');
        const failed = await runtime.execute('error', 'let progress = 4; throw new Error("expected failure")');
        assert.equal(failed.error, 'expected failure');
        assert(failed.declarations.some(binding => binding.name === 'progress'));
        assert.deepEqual((await runtime.execute('continue', 'progress += value.count; vm.print(progress)')).prints, ['7']);
        assert.equal((await runtime.execute('immutable', 'Object.getOwnPropertyDescriptor(globalThis, "vm")!.configurable')).output, 'false');
        assert.match(runtime.validate('vm.print = () => {}')!, /read-only/);
        assert.throws(() => validatePath('vm.print'), /reserved/);
        assert.throws(() => runtime.update({ declarations: '', paths: ['vm.custom'] }), /reserved/);
        const names = complete(runtime, environment, 'vm.').candidates.map(candidate => candidate.name);
        assert(names.includes('print') && names.includes('restart'));
    } finally { runtime.dispose(); }
});

test('restart transfers selected values and binding kinds into a new Context and leaves failed transfers intact', async () => {
    const runtime = new SessionRuntime(async () => undefined);
    try {
        const restart = await runtime.execute('restart', 'const retained = { count: 2 }; let counter = 1; const dropped = 9; vm.restart(["retained", "counter", "retained"])');
        assert.equal(restart.restarted, true);
        assert.deepEqual(restart.declarations.map(binding => [binding.name, binding.kind]), [['retained', 'const'], ['counter', 'let']]);
        assert.match(runtime.validate('dropped')!, /Cannot find name/);
        assert.match(runtime.validate('retained = {count: 1}')!, /constant/);
        assert.equal((await runtime.execute('after', 'counter += retained.count; counter')).output, '3');
        await runtime.execute('function', 'const handler = () => counter;');
        const failed = await runtime.execute('failed-restart', 'vm.restart(["handler"])');
        assert.match(failed.error!, /clone/i);
        assert(!failed.restarted);
        assert.equal((await runtime.execute('old-context', 'handler()')).output, '3');
        assert.match((await runtime.execute('unknown-restart', 'vm.restart(["absent"])')).error!, /unknown VM binding/);
        const empty = await runtime.execute('empty-restart', 'vm.restart()');
        assert.equal(empty.restarted, true);
        assert.deepEqual(empty.declarations, []);
        assert.deepEqual((await runtime.execute('new', 'vm.print("fresh")')).prints, ['fresh']);
    } finally { runtime.dispose(); }
});

test('isolated worker preserves print, error and selected-binding restart feedback over IPC', async () => {
    const runtime = new IsolatedSession(async () => undefined);
    try {
        await runtime.update(environment);
        assert.deepEqual((await runtime.execute('print', 'const value = 6; vm.print(value)')).prints, ['6']);
        assert.equal((await runtime.execute('error', 'throw new Error("worker failure")')).error, 'worker failure');
        assert.equal((await runtime.execute('restart', 'vm.restart(["value"])')).restarted, true);
        assert.equal((await runtime.execute('after', 'value + 1')).output, '7');
    } finally { runtime.dispose(); }
});
