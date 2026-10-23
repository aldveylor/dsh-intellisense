import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionInstructions, namespaceDirectory } from '../../src/integration/prompt.js';

test('protocol guidance demonstrates terminal completion and follows user language without selecting a default language', () => {
    const prompt = executionInstructions('<|CUSTOM_SENSE|>', 'std.fs.read');
    assert(prompt.includes('`return await std.fs.read<|CUSTOM_SENSE|>`'));
    assert(!prompt.includes('```js:exec\nreturn await'));
    assert(prompt.includes('STOP the response immediately without a closing fence'));
    assert(prompt.includes('unless the user explicitly requests another language'));
    assert(prompt.includes('Synthetic user-role continuation messages are not new human requests.'));
    assert(prompt.includes("Use the language of the user's human-authored request"));
    assert(!prompt.includes('Chinese'));
    assert(!prompt.includes('<|INTELLISENSE|>'));
    assert(prompt.includes('<|LINEBREAK|>'));
    assert(prompt.includes('<|BREAK|>'));
});

test('namespace item groups and deduplicates actual enabled commands without inventing signatures', () => {
    const tree = namespaceDirectory(['std.fs.write', 'vm.restart', 'std.fs.read', 'std.fs.read']);
    assert(tree.includes('## 命名空间'));
    assert(tree.includes('namespace global {'));
    assert(tree.includes('namespace std {'));
    assert(tree.includes('read: Function;'));
    assert(tree.includes('restart: Function;'));
    assert(tree.includes('```ts:namespace'));
    assert(!tree.includes('Promise<'));
});
