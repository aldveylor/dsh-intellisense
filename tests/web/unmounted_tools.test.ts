import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { TreeProvider, unmountedTools } from '../../src/web/tree_provider.js';
import type { Mapping, PhysicalTool } from '../../src/registry/registry.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { managementHtml } from '../../src/web/ui.js';

/** @brief Wait for React to commit an observable browser state. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'Expected unmounted tool state was not rendered');
}

/** @brief Create physical tools independently of their enabled or unavailable mappings. */
function tools(): PhysicalTool[] {
    return ['read', 'write', 'search'].map(id => ({ id, description: `${id} documentation`, parameters: { type: 'object' }, output: { type: 'string' } }));
}

test('unmounted count excludes unavailable identities and counts disabled mounted tools as mounted', () => {
    const mappings: Mapping[] = [
        { id: 'write', path: 'std.write', aliases: ['backup.write'], enabled: false, pinned: false },
        { id: 'read', path: ' ', aliases: [], enabled: true, pinned: false },
        { id: 'missing', path: 'std.missing', aliases: [], enabled: true, pinned: false },
    ];
    assert.deepEqual(unmountedTools(tools(), mappings).map(tool => tool.id), ['read', 'search']);
    assert(!TreeProvider().some(namespace => namespace.path === 'unknown'));
    assert(TreeProvider().some(namespace => namespace.path === 'vm'));
});

test('unknown is absent; count follows mounting, unmounting, saving and profile switching in both languages', async () => {
    const script = await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8');
    for (const language of ['en-US', 'zh-CN']) {
        const registry = new SemanticRegistry(new MemoryStore());
        registry.refresh(tools());
        await registry.configure([{ id: 'write', path: 'std.write', aliases: [], enabled: true, pinned: false }], 0);
        await registry.manageProfile('create', 'Empty', registry.snapshot().revision);
        await registry.manageProfile('select', 'Default', registry.snapshot().revision);
        const console = new VirtualConsole();
        console.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
        const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
        try {
            const { window } = dom;
            const { document } = window;
            Object.defineProperty(window.navigator, 'languages', { value: [language] });
            // jsdom lacks the native dialog methods; exercise the actual React picker handlers.
            window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
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
            window.eval(script);
            const counter = () => document.querySelector<HTMLButtonElement>('[data-unmounted-count]');
            const count = () => Number(counter()?.dataset.unmountedCount);
            await until(() => counter() !== null && count() === 2);
            assert.equal(counter()!.textContent, language === 'zh-CN' ? '2 个工具未挂载' : '2 unmounted tools');
            assert.equal(document.querySelector('[data-namespace-path="unknown"],[data-tree-path^="unknown."]'), null);
            counter()!.click();
            await until(() => document.querySelector('dialog[open]') !== null);
            assert.equal(document.querySelectorAll('dialog [data-tool-id]').length, 2);
            assert.equal(document.querySelector('dialog [data-tool-id="write"]'), null);
            document.querySelector<HTMLButtonElement>('dialog [data-tool-id="read"]')!.click();
            await until(() => count() === 1 && !!document.querySelector('[data-tree-path="read"]'));
            assert.equal(document.querySelector('dialog'), null);
            document.querySelector<HTMLButtonElement>('[data-tree-path="read"] .ts-remove')!.click();
            await until(() => count() === 2 && !document.querySelector('[data-tree-path="read"]'));
            counter()!.click();
            await until(() => !!document.querySelector('dialog [data-tool-id="read"]'));
            document.querySelector<HTMLButtonElement>('dialog [data-tool-id="read"]')!.click();
            await until(() => count() === 1);
            counter()!.click();
            await until(() => !!document.querySelector('dialog [data-tool-id="search"]'));
            document.querySelector<HTMLButtonElement>('dialog [data-tool-id="search"]')!.click();
            await until(() => count() === 0);
            assert(counter()!.disabled);
            const saveText = language === 'zh-CN' ? '保存' : 'Save';
            const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === saveText)!;
            assert(save, 'Localized save action exists');
            save.click();
            await until(() => registry.snapshot().mappings.length === 3 && !save.disabled);
            assert.equal(count(), 0);
            assert(!registry.snapshot().namespaces?.some(namespace => namespace.path === 'unknown'));
            const select = document.querySelector<HTMLSelectElement>('select[aria-label="Profile"]')!;
            select.value = 'Empty'; select.dispatchEvent(new window.Event('change', { bubbles: true }));
            await until(() => registry.snapshot().profile === 'Empty' && count() === 3 && !select.disabled);
            select.value = 'Default'; select.dispatchEvent(new window.Event('change', { bubbles: true }));
            await until(() => registry.snapshot().profile === 'Default' && count() === 0 && !select.disabled);
            assert.equal(document.querySelector('[data-namespace-path="unknown"]'), null);
        } finally { dom.window.close(); }
    }
});
