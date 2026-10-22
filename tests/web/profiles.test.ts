import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { managementHtml } from '../../src/web/ui.js';

/** @brief Wait for the asynchronous editor state to settle. */
async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await delay(10); }
    assert(predicate(), 'Profile editor did not reach expected state');
}

test('profile UI manages configurations and replaces draft notices with a name star', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Read', parameters: { type: 'object' }, output: { type: 'string' } }]);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    try {
        const { window } = dom; const document = window.document;
        window.structuredClone = structuredClone;
        window.fetch = async (_url: unknown, options?: RequestInit) => {
            if (options?.body) {
                const body = JSON.parse(String(options.body));
                if (body.action === 'profile') await registry.manageProfile(body.operation, body.name, body.revision, body.newName);
                else await registry.configure(body.mappings, body.revision, body.namespaces, body.order, body.unknownVisible);
                return Response.json({ ok: true });
            }
            return Response.json({ state: registry.snapshot(), tools: registry.tools(), effective: registry.effective(), declarations: '', sessions: [] });
        };
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        const select = () => document.querySelector<HTMLSelectElement>('select[aria-label="Profile"]')!;
        const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label)!;
        await until(() => select()?.value === 'Default' && !select().disabled);
        assert.equal(select().selectedOptions[0]!.textContent, 'Default');
        assert(button('删除 Profile').disabled);
        document.querySelector<HTMLButtonElement>('[aria-label="展开或收起 unknown"]')!.click();
        await until(() => !!document.querySelector('[data-tree-path="unknown.read"] .ts-pin'));
        document.querySelector<HTMLButtonElement>('[data-tree-path="unknown.read"] .ts-pin')!.click();
        await until(() => select().selectedOptions[0]!.textContent === 'Default *');
        assert(!document.body.textContent!.includes('请保存配置'));
        button('保存配置').click();
        await until(() => registry.snapshot().revision === 1 && !select().disabled && select().selectedOptions[0]!.textContent === 'Default');
        /** @brief Submit the inline name form through its React handler. */
        async function nameProfile(action: string, name: string): Promise<void> {
            button(action).click();
            await until(() => !!document.querySelector('input[aria-label="Profile 名称"]'));
            const input = document.querySelector<HTMLInputElement>('input[aria-label="Profile 名称"]')!;
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, name);
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
            await delay(10);
            input.closest('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
            await until(() => select().value === name && !select().disabled);
        }
        await nameProfile('新建 Profile', 'Work');
        assert.deepEqual(registry.snapshot().unknownVisible, []);
        assert.equal(select().options.length, 2);
        await nameProfile('重命名 Profile', 'Office');
        select().value = 'Default'; select().dispatchEvent(new window.Event('change', { bubbles: true }));
        await until(() => registry.snapshot().profile === 'Default' && !select().disabled);
        assert.deepEqual(registry.snapshot().unknownVisible, ['read']);
        button('删除 Profile').click();
        await until(() => select().value === 'Office' && !select().disabled);
        assert.equal(select().options.length, 1); assert(button('删除 Profile').disabled);
        assert.equal(document.querySelector('.ts-intellisense style')!.textContent!.includes('.ts-profile-picker'), true);
    } finally { dom.window.close(); }
});
