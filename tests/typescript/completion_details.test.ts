import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../../src/runtime/session.js';
import { complete } from '../../src/typescript/completion.js';
import { environmentPrompt } from '../../src/protocol/prompt.js';

const environment = {
    declarations: `declare const std: { fs: {
        /** Read the selected file. */
        read: (args: {
            /** Absolute source path. */
            path: string
        }) => Promise<string>;
        /** Read several lines. */
        readLines: (args: {
            /** Number of lines. */
            count: number
        }) => Promise<string[]>;
    } };`,
    paths: ['std.fs.read', 'std.fs.readLines'],
};

test('namespace and partial names omit parameters while exact names and opening calls expose selected details', () => {
    const runtime = new SessionRuntime(async () => '');
    try {
        runtime.update(environment);
        const namespace = complete(runtime, environment, 'std.fs.');
        assert.deepEqual(namespace.candidates.map(candidate => candidate.name), ['read', 'readLines']);
        assert(!namespace.context.includes('path: string'));
        assert(!namespace.context.includes('count: number'));
        assert.deepEqual(namespace.signatures, []);
        const partial = complete(runtime, environment, 'std.fs.rea');
        assert(!partial.context.includes('path: string'));
        const selected = complete(runtime, environment, 'std.fs.read');
        assert(selected.candidates.some(candidate => candidate.name === 'readLines'));
        assert.match(selected.signatures.join('\n'), /path: string/);
        assert.match(selected.signatures.join('\n'), /Absolute source path/);
        assert(!selected.context.includes('count: number'));
        assert(!selected.context.includes('Number of lines'));
        const call = complete(runtime, environment, 'std.fs.read(');
        assert.deepEqual(call.candidates, []);
        assert.match(call.signatures.join('\n'), /path: string/);
        assert.match(call.signatures.join('\n'), /Absolute source path/);
        assert(!call.context.includes('readLines'));
        const fields = complete(runtime, environment, 'std.fs.read({');
        assert(fields.candidates.some(candidate => candidate.name === 'path' && candidate.documentation.includes('Absolute source path')));
    } finally { runtime.dispose(); }
});

test('prompt allows known tools directly and documents the three distinct lookup positions', () => {
    const prompt = environmentPrompt(['std'], 'test');
    assert.match(prompt, /Call a known tool directly/);
    for (const cursor of ['std.fs.<|INTELLISENSE|>', 'std.fs.read<|INTELLISENSE|>', 'std.fs.read(<|INTELLISENSE|>']) assert(prompt.includes(cursor));
    assert(!prompt.includes('Inspect tool names first.'));
});
