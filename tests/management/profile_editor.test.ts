import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
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

test('editor selection, local creation and saving remain independent from the default selector', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { ManagementPanel } from './src/management/panel/management_panel.js';
            import { NativeProfileSelect } from './src/management/profile_picker/native_profile_select.js';
            createRoot(document.getElementById('root')).render(<ManagementPanel api='/api/ts-intellisense-state' ProfileSelect={NativeProfileSelect} />);
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, write: false,
    });
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/', runScripts: 'outside-only', virtualConsole });
    const document = dom.window.document;
    dom.window.structuredClone = structuredClone;
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.fetch = async (url, init) => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), dom.window.location.href), { ...init as RequestInit, signal: undefined }));
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        const button = (selector: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(selector)!;
        await until(() => !!document.querySelector('.ts-default-profile button:not(:disabled)'));
        button('.ts-default-profile button').click();
        await until(() => !!document.querySelector('.ts-default-profile .ts-profile-option'));
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-delete'), null);
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-create'), null);
        button('.ts-namespace-profile button[aria-label="Create profile"]').click();
        await until(() => !!document.querySelector('dialog input'));
        const input = document.querySelector<HTMLInputElement>('dialog input')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Draft');
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        await until(() => !button('dialog button[type="submit"]').disabled);
        button('dialog button[type="submit"]').click();
        await until(() => document.querySelector('.ts-namespace-profile .ts-profile-label')?.textContent === 'Draft *');
        assert.deepEqual(registry.snapshot().profiles, ['Default']);
        assert.equal(document.querySelector('.ts-default-profile .ts-profile-label')?.textContent, 'Default');
        button('.ts-namespace-profile .ts-profile-select>button').click();
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
