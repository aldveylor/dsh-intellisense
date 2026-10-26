import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionInstructions, namespaceDirectory } from '../../src/namespace/prompt.js';

test('execution guidance selects native named arguments or conversation-scoped async PTC execution', () => {
    const native = executionInstructions('native');
    assert(native.includes('native DSML tools with named arguments'));
    assert(native.includes('ns_tools__intellisense'));
    assert(!native.includes('TypeScript/JavaScript'));
    const ptc = executionInstructions('ptc');
    assert(ptc.includes('Call tools_run_code with code'));
    assert(ptc.includes('async TypeScript/JavaScript function body'));
    assert(ptc.includes('attach variables to globalThis'));
    assert(ptc.includes('continuity is not guaranteed'));
    assert(ptc.includes('tools.profile.annotation, tools.profile.commands and tools.profile.profiles are preloaded read-only fields'));
    for (const prompt of [native, ptc]) {
        assert(!prompt.includes('<|INTELLISENSE|>'));
        assert(!prompt.includes('js:exec'));
    }
});

test('namespace item groups and deduplicates actual enabled commands without inventing signatures', () => {
    const tree = namespaceDirectory(['std.fs.write', 'std.cwd', 'std.fs.read', 'std.fs.read']);
    assert(tree.includes('Current partial namespace structure:'));
    assert.equal(tree.match(/const read:/g)?.length, 1);
    assert(tree.includes('namespace global {'));
    assert(tree.includes('namespace std {'));
    assert(tree.includes('read: Function;'));
    assert(tree.includes('cwd: Function;'));
    assert(tree.includes('```ts:namespace'));
    assert(!tree.includes('Promise<'));
});

test('namespace briefs decode HTML entities before formatting the prompt', () => {
    const prompt = namespaceDirectory([{ path: 'std.cwd', description: 'Read &amp; change &lt;directory&gt;' }]);
    assert(prompt.includes('/** @brief Read & change <directory> */'));
    assert(!prompt.includes('&amp;'));
});
