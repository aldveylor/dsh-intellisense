import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
import { createNamespace } from '../../src/namespace/namespace.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { TreeProvider, unmountedTools } from '../../src/management/panel/tree_provider.js';
import type { Mapping, PhysicalTool } from '../../src/registry/registry.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { managementHtml } from '../../src/management/server/page.js';

/** @brief Exercise the actual management API, including editor selection and permissions. */
function managementFetch(registry: SemanticRegistry) {
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    return async (url: unknown, init?: RequestInit): Promise<Response> => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), 'http://localhost'), { ...init, signal: undefined }));
}

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
        { id: 'write', path: 'std.write', disabled: true, pinned: false },
        { id: 'write', path: 'backup.write', disabled: true, pinned: false },
        { id: 'read', path: ' ', pinned: false },
        { id: 'missing', path: 'std.missing', pinned: false },
    ];
    assert.deepEqual(unmountedTools(tools(), mappings).map(tool => tool.id), ['read', 'search']);
    assert(!TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!).some(namespace => namespace.path === 'unknown'));
    assert(!TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!).some(namespace => namespace.path === 'vm'));
    assert(TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!).some(namespace => namespace.path === 'tools'));
});

test('unknown is absent; count follows mounting, unmounting, saving and profile switching in both languages', async () => {
    const script = await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8');
    for (const language of ['en-US', 'zh-CN']) {
        const registry = new SemanticRegistry(new MemoryStore());
        registry.refresh(tools());
        await registry.configure([{ id: 'write', path: 'std.write', pinned: false }], 0);
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
            window.fetch = managementFetch(registry);
            window.eval(script);
            const counter = () => document.querySelector<HTMLButtonElement>('[data-unmounted-count]');
            const count = () => Number(counter()?.dataset.unmountedCount);
            await until(() => counter() !== null && count() === 2);
            assert.equal(counter()!.textContent, language === 'zh-CN' ? '2 个工具未挂载' : '2 unmounted tools');
            assert.equal(document.querySelector('[data-namespace-path="unknown"],[data-tree-path^="unknown."]'), null);
            counter()!.click();
            await until(() => document.querySelector('dialog[open]') !== null);
            assert.equal(document.querySelectorAll('dialog [data-tool-id]:not(:disabled)').length, 2);
            assert.equal(document.querySelector('dialog [data-tool-id="write"]'), null);
            document.querySelector<HTMLButtonElement>('dialog [data-tool-id="read"]')!.click();
            await until(() => count() === 1 && !!document.querySelector('[data-tree-path="read"][data-tool-status]'));
            assert.equal(document.querySelector('dialog'), null);
            document.querySelector<HTMLButtonElement>('[data-tree-path="read"] .ts-remove:not(.ts-disable)')!.click();
            await until(() => count() === 2 && !document.querySelector('[data-tree-path="read"][data-tool-status]'));
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
            const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-label') === saveText)!;
            assert(save, 'Localized save action exists');
            save.click();
            await until(() => registry.snapshot().mappings.length === 3 && !save.disabled);
            assert.equal(count(), 0);
            assert(!registry.snapshot().namespaces?.some(namespace => namespace.path === 'unknown'));
            const select = document.querySelector<HTMLButtonElement>('.ts-namespace-profile .ts-profile-select > button')!;
            select.click();
            await until(() => document.querySelectorAll('.ts-namespace-profile .ts-profile-option').length === 2);
            for (const [name, expected] of [['Empty', 3], ['Default', 0]] as const) {
                const option = document.querySelector<HTMLButtonElement>(`.ts-namespace-profile [data-profile-value="${name}"] .ts-profile-option`);
                assert(option, `Profile option exists: ${name}`);
                option.click();
                await until(() => count() === expected && !select.disabled);
                assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent, name);
            }
            assert.equal(document.querySelector('[data-namespace-path="unknown"]'), null);
        } finally { dom.window.close(); }
    }
});

test('built-in namespace and command descriptions stay English in a Chinese interface', async () => {
    const console = new VirtualConsole();
    console.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', virtualConsole: console });
    try {
        const { window } = dom;
        Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN'] });
        window.structuredClone = structuredClone;
        window.fetch = async () => Response.json({
            state: { version: 1, revision: 0, mappings: [], namespaces: [], usage: {}, profile: 'Default', profiles: ['Default'] },
            tools: [], effective: [], provided: createNamespace({ tools: [], includeUnavailable: true }).serialize().children, declarations: '', sessions: [],
        });
        window.eval(await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8'));
        const { document } = window;
        await until(() => !!document.querySelector('[data-unmounted-count]'));
        assert.equal(document.querySelector('[data-unmounted-count]')!.textContent, '0 个工具未挂载');
        for (const namespace of TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!)) {
            const block = document.querySelector(`[data-namespace-path="${namespace.path}"]`)!;
            assert.equal(block.querySelector('.ts-node-preview')!.textContent, namespace.description);
            block.querySelector<HTMLButtonElement>('.ts-disclosure')!.click();
            await until(() => !!document.querySelector(`[data-tree-path="${namespace.commands[0]!.path}"]`));
            for (const command of namespace.commands) {
                const row = document.querySelector(`[data-tree-path="${command.path}"]`)!;
                assert.equal(row.querySelector('.ts-tool-preview')!.textContent, command.description);
                assert.equal(row.getAttribute('title'), null);
                assert(row.hasAttribute('aria-describedby'));
                assert.equal((row as HTMLElement).draggable, false);
            }
        }
        assert.equal(document.querySelector('[data-tree-path="vm.print"]'), null);
        assert.equal(document.querySelector('[data-namespace-path="unknown"]'), null);
    } finally { dom.window.close(); }
});

test('built-in pins cycle through three levels, discovery stays detailed and preferences survive Profile changes', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([]);
    const console = new VirtualConsole();
    console.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', virtualConsole: console });
    try {
        const { window } = dom;
        Object.defineProperty(window.navigator, 'languages', { value: ['en-US'] });
        window.structuredClone = structuredClone;
        window.fetch = managementFetch(registry);
        window.eval(await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8'));
        const { document } = window;
        await until(() => !!document.querySelector('[data-unmounted-count]'));
        for (const path of ['tools']) document.querySelector<HTMLButtonElement>(`[data-namespace-path="${path}"] .ts-disclosure`)!.click();
        const pin = (path: string) => document.querySelector<HTMLButtonElement>(`[data-tree-path="${path}"] .ts-pin`)!;
        await until(() => !!pin('tools.search') && !!pin('tools.intellisense'));
        assert(!pin('tools.search').disabled);
        assert(pin('tools.intellisense').disabled);
        assert.equal(pin('tools.intellisense').dataset.level, '2');
        assert.equal(pin('tools.search').dataset.level, '0');
        for (const level of [1, 2, 0, 1, 2]) {
            pin('tools.search').click();
            await until(() => pin('tools.search').dataset.level === String(level));
        }
        assert.equal(document.querySelector('[data-tree-path="tools.mount"]'), null);
        const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-label') === label)!;
        button('Save').click();
        await until(() => registry.snapshot().builtinVisible?.['tools.search'] === 2 && !button('Save').disabled);
        assert.equal(pin('tools.intellisense').dataset.level, '2');
        button('Refresh').click();
        await until(() => !button('Refresh').disabled && pin('tools.search').getAttribute('aria-pressed') === 'true');
        assert.equal(pin('tools.search').dataset.level, '2');
        const initial = registry.configuration();
        await registry.manageProfile('create', 'Other', registry.snapshot().revision);
        assert.equal(registry.configuration().builtinVisible?.['tools.search'] ?? 0, 0);
        assert.equal(TreeProvider(createNamespace({ tools: [], includeUnavailable: true }).serialize().children!).find(node => node.path === 'tools')!.commands.find(command => command.path === 'tools.intellisense')!.alwaysVisible, 2);
        await registry.manageProfile('select', 'Default', registry.snapshot().revision);
        assert.deepEqual(registry.configuration().builtinVisible, initial.builtinVisible);
    } finally { dom.window.close(); }
});
