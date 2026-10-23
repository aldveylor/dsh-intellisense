import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { CompletionSettings } from '../../src/protocol/history.js';
import { MemoryStore } from '../../src/storage/store.js';
import { managementHtml } from '../../src/web/ui.js';

/** @brief Wait for React and its asynchronous settings request to settle. */
async function until(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 150; index++) { if (predicate()) return; await delay(10); }
    assert(predicate(), 'Settings UI did not reach the expected state');
}

test('UI saves history quotas independently, and edits comments on unknown tools without mounting them', async () => {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    registry.refresh([{ id: 'read', description: 'Original documentation', parameters: { type: 'object' }, output: { type: 'string' } }]);
    const settings = new CompletionSettings(store);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://local/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    try {
        const { window } = dom; const document = window.document;
        window.structuredClone = structuredClone;
        Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN'] });
        window.fetch = async (_url: unknown, options?: RequestInit) => {
            if (options?.body) {
                const body = JSON.parse(String(options.body));
                if (body.action === 'history') await settings.configure(body.historyLimits);
                else if (body.action === 'configure') await registry.configure(body.mappings, body.revision, body.namespaces, body.order, body.unknownVisible, body.profile, body.toolComments);
                else throw new Error('Unexpected action');
                return Response.json({ ok: true });
            }
            return Response.json({ state: registry.snapshot(), tools: registry.tools(), effective: registry.effective(), declarations: registry.declarations(), sessions: [], historyLimits: settings.limits() });
        };
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        await until(() => !!document.querySelector('.ts-history-settings input:not(:disabled)'));
        document.querySelector<HTMLButtonElement>('[aria-label="展开或收起 unknown"]')!.click();
        await until(() => !!document.querySelector('[data-tree-path="unknown.read"] .ts-tool-preview'));
        const comment = document.querySelector<HTMLElement>('[data-tree-path="unknown.read"] .ts-tool-preview')!;
        comment.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
        await until(() => !!document.querySelector('textarea'));
        const textarea = document.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Brief note');
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
        await delay(10);
        textarea.closest('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => comment.textContent === 'Brief note');
        assert.equal(comment.title, 'Original documentation');
        const inputs = document.querySelectorAll<HTMLInputElement>('.ts-history-settings input');
        for (const [index, value] of [5, 2].entries()) {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(inputs[index], String(value));
            inputs[index]!.dispatchEvent(new window.Event('input', { bubbles: true }));
        }
        await delay(10);
        document.querySelector<HTMLFormElement>('.ts-history-settings')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => settings.limits().namespace === 5 && settings.limits().command === 2);
        assert.equal(registry.snapshot().revision, 0);
        assert.equal(comment.textContent, 'Brief note');
        assert(document.querySelector('select')!.selectedOptions[0]!.textContent!.includes('*'));
        const save = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存')!;
        await until(() => !save.disabled);
        save.click();
        await until(() => registry.snapshot().toolComments?.read === 'Brief note');
        assert.deepEqual(registry.snapshot().mappings, []);
        assert.equal(registry.effective()[0]!.description, 'Brief note');
        assert.match(registry.declarations(), /Original documentation/);
        assert.doesNotMatch(registry.declarations(), /Brief note/);
    } finally { dom.window.close(); }
});
