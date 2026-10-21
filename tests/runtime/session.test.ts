import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../../src/runtime/session.js';
import { complete } from '../../src/typescript/completion.js';

const make = (): SessionRuntime => new SessionRuntime(async (_p, args) => args);

test('persistent const/let, top-level await, final expressions and declarations', async () => {
    const runtime = make();
    assert.equal((await runtime.execute('1', 'const value = await Promise.resolve(3); let count = 2;')).output, '');
    assert.equal((await runtime.execute('2', 'count += value; count')).output, '5');
    await assert.rejects(runtime.execute('3', 'value = 9'), /constant|read-only|TS2588/);
    await assert.rejects(runtime.execute('4', 'const value = 4'), /already been declared/);
    await runtime.execute('5', 'const obj: { value?: number } = { value: 9 };');
    assert.equal((await runtime.execute('6', 'delete obj.value; obj.value')).output, '');
    await assert.rejects(runtime.execute('7', 'delete value'), /TS2703|TS1102/);
    runtime.dispose();
});

test('closures, hoisted functions, lexical shadows and object shorthand', async () => {
    const runtime = make();
    await runtime.execute('1', 'let count = 1; function inc() { count++; return count; }');
    assert.equal((await runtime.execute('2', 'inc()')).output, '2');
    assert.equal((await runtime.execute('3', 'await (async () => { const count = 8; return {count}; })()')).output, '{ count: 8 }');
    assert.equal((await runtime.execute('4', '({count})')).output, '{ count: 2 }');
    runtime.dispose();
});

test('execution IDs suppress repeat dispatch and session contexts are isolated', async () => {
    const runtime = make();
    await runtime.execute('1', 'let value = 0');
    const [a, b] = await Promise.all([runtime.execute('2', '++value'), runtime.execute('2', '++value')]);
    assert.equal(a.output, '1'); assert.equal(b.output, '1');
    await assert.rejects(runtime.execute('2', 'value += 10'), /identity/);
    const other = make();
    await assert.rejects(other.execute('1', 'value'), /Cannot find name/);
    runtime.dispose(); other.dispose();
});

test('incomplete source, undeclared host APIs and markers never execute', async () => {
    const runtime = make();
    await runtime.execute('1', 'let value = 0');
    await assert.rejects(runtime.execute('2', 'value++; await Promise.'), /TS/);
    assert.equal((await runtime.execute('3', 'value')).output, '0');
    await assert.rejects(runtime.execute('4', 'process.env'), /Cannot find name/);
    await assert.rejects(runtime.execute('5', 'value++; <|INTELLISENSE|>'), /markers/);
    runtime.dispose();
});

test('completion uses namespace, property, persistent variable and argument types', async () => {
    const runtime = make();
    const env = { declarations: 'declare const std: { fs: { read(args: { path: string }): Promise<string> } };', paths: ['std.fs.read'] };
    runtime.update(env);
    await runtime.execute('1', 'const person = { name: "A", age: 3 };');
    assert(complete(runtime, env, 'await std.fs.').candidates.some(c => c.name === 'read' && c.signature.includes('Promise<string>')));
    assert(complete(runtime, env, 'person.na').candidates.some(c => c.name === 'name'));
    assert(complete(runtime, env, 'pers').candidates.some(c => c.name === 'person'));
    assert(complete(runtime, env, 'std.fs.read(').signatures.some(s => s.includes('path')));
    runtime.dispose();
});

test('checkpoints restore data without reexecuting tools or closures', async () => {
    const runtime = make();
    await runtime.execute('1', 'const data = { value: 7 }; const f = () => data;');
    const checkpoint = runtime.checkpoint();
    assert.deepEqual(checkpoint.omitted, ['f']);
    const restored = make(); restored.restore(checkpoint);
    assert.equal((await restored.execute('2', 'data.value')).output, '7');
    runtime.dispose(); restored.dispose();
});


test('native Promise supports execution and completion without legacy helpers', async () => {
    const runtime = make();
    const env = { declarations: '', paths: [] };
    try {
        assert.equal((await runtime.execute('promise', 'await Promise.all([Promise.resolve(2), 3])')).output, '[ 2, 3 ]');
        const names = complete(runtime, env, 'Promise.').candidates.map(c => c.name);
        for (const name of ['all', 'race', 'allSettled', 'any']) assert(names.includes(name));
        await assert.rejects(runtime.execute('old', 'whenAll([1])'), /Cannot find name/);
        await assert.rejects(runtime.execute('shadow', 'const Promise = 1'), /Reserved binding/);
    } finally { runtime.dispose(); }
});
