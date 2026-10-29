import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/web/server/routes.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Wait for a browser state transition to commit. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'Expected profile editor transition');
}

const mapping = { id: 'read', path: 'file.read', pinned: false, alwaysVisible: 1 as const };

/** @brief Mount the editor against real management routes and record browser requests. */
async function fixture(prepare: (registry: SemanticRegistry) => Promise<void> = async () => {}, inspectLoading?: (document: Document) => void, failInitialLoad = false) {
    const store = new MemoryStore();
    const registry = new SemanticRegistry(store);
    await registry.load();
    registry.refresh([{ id: 'read', description: 'Read a file', parameters: {}, output: {} }]);
    await registry.configure([mapping], registry.revision);
    await prepare(registry);
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { ManagementPanel } from './src/web/panel/management_panel.js';
            import { NativeProfileSelect } from './src/web/profile_picker/native_profile_select.js';
            createRoot(document.getElementById('root')).render(<ManagementPanel api='/api/ts-intellisense-state' ProfileSelect={NativeProfileSelect} />);
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.md': 'text' }, write: false,
    });
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/', runScripts: 'outside-only', virtualConsole });
    const document = dom.window.document;
    dom.window.structuredClone = structuredClone;
    Object.defineProperty(dom.window, 'AnimationEvent', { value: dom.window.Event });
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    const requests: Request[] = [];
    dom.window.fetch = async (url, init) => {
        const request = new Request(new URL(String(url), dom.window.location.href), { ...init as RequestInit, signal: undefined });
        requests.push(request.clone());
        if (requests.length === 1) {
            inspectLoading?.(document);
            if (failInitialLoad) return Response.json({ error: 'Failed to load settings' }, { status: 400 });
        }
        return routes.get('/api/ts-intellisense-state')!(request);
    };
    const button = (selector: string): HTMLButtonElement => {
        const element = document.querySelector<HTMLButtonElement>(selector);
        assert(element, `Missing editor button: ${selector}`);
        return element;
    };
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        await until(() => failInitialLoad ? !!document.querySelector('.ts-load-overlay button') : !!document.querySelector('.ts-default-profile button:not(:disabled)'));
        return { registry, dom, document, button, requests };
    } catch (error) { dom.window.close(); throw error; }
}

test('editor loads and saves a renamed default without assuming a Default catalog entry', async () => {
    let inspectedLoading = false;
    const { registry, dom, document, button, requests } = await fixture(async registry => {
        await registry.manageProfile('rename', 'Default', registry.snapshot().revision, 'Work');
    }, document => {
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-label')?.textContent, '');
        assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent, '');
        inspectedLoading = true;
    });
    try {
        assert(inspectedLoading);
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-label')?.textContent, 'Work');
        assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent, 'Work');
        assert.equal(new URL(requests[0]!.url).searchParams.has('profile'), false);
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => requests.length === 3 && document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        assert.equal(new URL(requests[2]!.url).searchParams.get('profile'), 'Work');
        assert.deepEqual(registry.snapshot().profiles, ['Work']);
        assert.equal(registry.snapshot().profile, 'Work');
        assert.deepEqual(registry.configuration().mappings, [mapping]);
    } finally { dom.window.close(); }
});

test('editor selection, local creation and saving remain independent from the default selector', async () => {
    const { registry, dom, document, button } = await fixture();
    try {
        const revision = registry.revision;
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => registry.revision === revision + 1);
        await until(() => document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        assert.deepEqual(registry.snapshot().mappings, [mapping]);
        const saveAnimation = document.querySelector('[data-action="save"]')!;
        saveAnimation.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => saveAnimation.getAttribute('data-running') === 'false');
        button('.ts-default-profile button').click();
        await until(() => !!document.querySelector('.ts-default-profile .ts-profile-option'));
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-delete'), null);
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-create'), null);
        button('.ts-namespace-profile .ts-profile-select>button').click();
        await until(() => !!document.querySelector('.ts-namespace-profile .ts-profile-create input'));
        const input = document.querySelector<HTMLInputElement>('.ts-namespace-profile .ts-profile-create input')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Draft');
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        document.querySelector('.ts-namespace-profile .ts-profile-create')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Draft *');
        assert.deepEqual(registry.snapshot().profiles, ['Default']);
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-label')?.textContent, 'Default');
        await until(() => !!document.querySelector('.ts-namespace-profile .ts-profile-delete'));
        assert.equal(button('.ts-namespace-profile .ts-profile-delete[aria-label="Delete profile Default"]').disabled, true);
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Draft');
        assert.equal(registry.snapshot().profile, 'Default');
        assert.deepEqual(registry.snapshot().profiles, ['Default', 'Draft']);
        // The default selector changes only the default and keeps the editor on Draft.
        button('.ts-default-profile button').click();
        await until(() => document.querySelectorAll('.ts-default-profile .ts-profile-option').length === 2);
        const options = Array.from(document.querySelectorAll<HTMLButtonElement>('.ts-default-profile .ts-profile-option'));
        options.find(option => option.textContent === 'Draft')!.click();
        await until(() => registry.snapshot().profile === 'Draft');
        await until(() => document.querySelector('.ts-default-profile .ts-profile-label')?.textContent === 'Draft');
        assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent, 'Draft');
        button('.ts-namespace-profile .ts-profile-select>button').click();
        await until(() => document.querySelectorAll('.ts-namespace-profile .ts-profile-option').length === 2);
        Array.from(document.querySelectorAll<HTMLButtonElement>('.ts-namespace-profile .ts-profile-option')).find(option => option.textContent === 'Default')!.click();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Default');
        assert.equal(registry.snapshot().profile, 'Draft');
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-label')?.textContent, 'Draft');
    } finally { dom.window.close(); }
});


test('Profile updates preserve expanded rows and default updates leave the tree DOM untouched', async () => {
    const { registry, dom, document, button, requests } = await fixture(async registry => {
        await registry.saveProfile('Other', { ...registry.configuration(), mappings: [{ ...mapping, description: 'Other brief' }] });
    });
    let release = (): void => {};
    try {
        button('[data-tree-path="file"] .ts-disclosure').click();
        await until(() => !!document.querySelector('[data-tree-path="file.read"]'));
        const tree = document.querySelector('.ts-tree')!;
        const namespace = document.querySelector('[data-tree-path="file"]');
        const command = document.querySelector('[data-tree-path="file.read"]')!;
        const mutations: MutationRecord[] = [];
        const observer = new dom.window.MutationObserver(records => mutations.push(...records));
        observer.observe(tree, { attributes: true, childList: true, characterData: true, subtree: true });
        try {
            const fetch = dom.window.fetch;
            const blocked = new Promise<void>(resolve => { release = resolve; });
            let started = false;
            dom.window.fetch = async (...args) => {
                dom.window.fetch = fetch;
                started = true;
                await blocked;
                return fetch(...args);
            };
            button('.ts-default-profile .ts-profile-select>button').click();
            await until(() => document.querySelectorAll('.ts-default-profile .ts-profile-option').length === 2);
            const before = requests.length;
            Array.from(document.querySelectorAll<HTMLButtonElement>('.ts-default-profile .ts-profile-option')).find(option => option.textContent === 'Other')!.click();
            await until(() => started && document.querySelector('.ts-default-profile')?.getAttribute('aria-busy') === 'true');
            mutations.push(...observer.takeRecords());
            assert.equal(mutations.length, 0, 'Pending default updates must not mutate tree rows');
            assert.equal(document.querySelector('[data-tree-path="file.read"]'), command);
            assert.equal(command.querySelector('button')!.disabled, false, 'Requests must not dim unchanged tree controls');
            release();
            await until(() => document.querySelector('.ts-default-profile .ts-profile-label')?.textContent === 'Other');
            mutations.push(...observer.takeRecords());
            assert.equal(mutations.length, 0, 'Completed default updates must not mutate tree rows');
            assert.equal(requests.length, before + 1, 'Default updates must not reload the full catalog');
            assert.equal(requests.at(-1)!.method, 'POST');
            assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent, 'Default');
        } finally { observer.disconnect(); }
        button('.ts-namespace-profile .ts-profile-select>button').click();
        await until(() => document.querySelectorAll('.ts-namespace-profile .ts-profile-option').length === 2);
        Array.from(document.querySelectorAll<HTMLButtonElement>('.ts-namespace-profile .ts-profile-option')).find(option => option.textContent === 'Other')!.click();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Other');
        assert.equal(document.querySelector('.ts-tree'), tree);
        assert.equal(document.querySelector('[data-tree-path="file"]'), namespace);
        assert.equal(document.querySelector('[data-tree-path="file.read"]'), command);
        assert.equal(command.querySelector('.ts-tool-preview')?.textContent, 'Other brief');
        assert.equal(registry.snapshot().profile, 'Other');
    } finally { release(); dom.window.close(); }
});


test('JSON imports retain expanded rows and remain dirty until the draft is saved', async () => {
    const { registry, dom, document, button } = await fixture();
    try {
        button('[data-tree-path="file"] .ts-disclosure').click();
        await until(() => !!document.querySelector('[data-tree-path="file.read"]'));
        const command = document.querySelector('[data-tree-path="file.read"]');
        const imported = { ...registry.configuration(), mappings: [{ ...mapping, description: 'Imported brief' }] };
        const file = new dom.window.File([JSON.stringify(imported)], 'profile.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: async () => JSON.stringify(imported) });
        const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
        Object.defineProperty(input, 'files', { value: [file] });
        input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Default *');
        assert.equal(document.querySelector('[data-tree-path="file.read"]'), command);
        assert.equal(command?.querySelector('.ts-tool-preview')?.textContent, 'Imported brief');
        assert.equal(registry.configuration().mappings[0]?.description, undefined, 'Import must not persist the draft');
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Default');
        assert.equal(registry.configuration().mappings[0]?.description, 'Imported brief');
        assert.equal(document.querySelector('[data-tree-path="file.read"]'), command);
    } finally { dom.window.close(); }
});


test('profile brief edits appear in menus and persist or clear only after Save', async () => {
    const { registry, dom, document, button } = await fixture(async registry => {
        await registry.saveProfile('Default', { ...registry.configuration(), brief: 'Read local files' });
    });
    try {
        button('.ts-default-profile button').click();
        await until(() => !!document.querySelector('.ts-default-profile .ts-profile-brief'));
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-brief')?.textContent, 'Read local files');
        document.querySelector('.ts-profile-summary [role="button"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
        await until(() => !!document.querySelector('textarea[aria-label="Profile description"]'));
        const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Profile description"]')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Development tools');
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Default *');
        assert.equal(registry.configuration().brief, 'Read local files');
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => registry.configuration().brief === 'Development tools');
        await until(() => document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        document.querySelector('[data-action="save"]')!.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => document.querySelector('[data-action="save"]')?.getAttribute('data-running') === 'false');
        document.querySelector('.ts-profile-summary [role="button"]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await until(() => !!document.querySelector('textarea[aria-label="Profile description"]'));
        const clear = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Profile description"]')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(clear, '');
        clear.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        clear.blur();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Default *');
        button('.ts-namespace-profile button[aria-label="Save"]').click();
        await until(() => registry.configuration().brief === undefined);
        await until(() => document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        button('.ts-namespace-profile .ts-profile-select>button').click();
        await until(() => !!document.querySelector('.ts-namespace-profile .ts-profile-option'));
        assert.equal(document.querySelector('.ts-namespace-profile .ts-profile-brief'), null);
    } finally { dom.window.close(); }
});


test('loading error overlay places Reset after Refresh and recovers failed data before reloading', async () => {
    const { registry, dom, document, requests } = await fixture(async registry => {
        await registry.manageProfile('create', 'Other', registry.snapshot().revision, undefined, false);
    }, undefined, true);
    try {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.ts-load-overlay button')];
        assert.deepEqual(buttons.map(button => button.textContent), ['Refresh', 'Reset']);
        const before = registry.snapshot();
        buttons[1]!.click();
        await until(() => !document.querySelector('.ts-load-overlay'));
        assert.deepEqual(await requests[1]!.json(), { action: 'recover' });
        assert.equal(requests[2]!.method, 'GET');
        assert.deepEqual(registry.snapshot(), before);
        assert.deepEqual(registry.configuration('Other').mappings, []);
    } finally { dom.window.close(); }
});
