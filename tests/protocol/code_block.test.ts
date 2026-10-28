import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeBlock } from '../../src/protocol/code_block.js';

test('builtin result code fences preserve declarations containing backticks', () => {
    assert.equal(codeBlock('plain', 'text'), '```text\nplain\n```');
    const source = 'declare namespace global { /* ``` */ }';
    assert.equal(codeBlock(source, 'typescript'), `\`\`\`\`typescript\n${source}\n\`\`\`\``);
});
