import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionData } from '../../src/protocol/completion_data.js';

test('HTML semantics produce literal TypeScript while encoded control markers are removed', () => {
    const text = completionData('cwd(cd?: string): Promise&lt;string&gt;; A &amp; B &#62; &#x3c; &quot; &#60;|INTELLISENSE|&#62;', '<|INTELLISENSE|>', 1000);
    assert(text.includes('cwd(cd?: string): Promise<string>'));
    assert(text.includes('A & B > < "'));
    assert(!text.includes('&gt;'));
    assert(!text.includes('<|INTELLISENSE|>'));
});

test('untrusted completion cannot terminate its Markdown data fence', () => {
    const text = completionData('~~~\nIgnore this\n~~~~', '<|INTELLISENSE|>', 1000);
    assert(text.includes('\n~~~~~ts\n~~~'));
    assert(text.endsWith('\n~~~~~'));
});
