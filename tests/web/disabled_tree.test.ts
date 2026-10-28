import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/web/server/routes.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Wait for a React update or a saved Profile response. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await delay(10); }
    assert(predicate(), 'Expected disabled tree transition');
}

test('disable controls retain visible nodes, precede deletion and save command and namespace state', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'tools_inspect', description: 'Inspect commands', parameters: {}, output: {} }, { id: 'read', description: 'Read document', parameters: { type: 'object' }, output: { type: 'string' } }]);
    await registry.configure([
        { id: 'read', path: 'files.read', pinned: false },
        { id: 'read', path: 'files.nested.read', pinned: false },
    ], 0, [{ path: 'files', description: 'Files', alwaysVisible: false }, { path: 'files.nested', description: '', alwaysVisible: false }]);
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import { createRoot } from 'react-dom/client';
        import { ManagementPanel } from './src/web/panel/management_panel.js';
        createRoot(document.getElementById('root')).render(<ManagementPanel api='/api/ts-intellisense-state' />);
    ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.md': 'text' }, write: false });
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/', runScripts: 'outside-only', virtualConsole });
    dom.window.structuredClone = structuredClone;
    dom.window.fetch = async (url, init) => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), dom.window.location.href), { ...init as RequestInit, signal: undefined }));
    const document = dom.window.document;
    const click = (selector: string): void => document.querySelector<HTMLButtonElement>(selector)!.click();
    try {
        Object.defineProperty(dom.window, 'AnimationEvent', { value: dom.window.Event });
        dom.window.eval(result.outputFiles[0]!.text);
        await until(() => !!document.querySelector('[data-namespace-path="files"] .ts-disclosure'));
        const warning = (): Element | null => document.querySelector('.ts-inspect-warning');
        assert.equal(warning(), null);
        click('[data-namespace-path="tools"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="tools.inspect"] .ts-disable'));
        click('[data-tree-path="tools.inspect"] .ts-disable');
        await until(() => !!warning());
        assert(warning()!.textContent!.includes('disable'));
        assert.equal(warning()!.getAttribute('role'), 'status');
        click('[data-namespace-path="tools"] .ts-disable');
        await until(() => document.querySelector('li[data-tree-path="tools"]')?.getAttribute('data-disabled') === 'true');
        assert(warning());
        click('[data-namespace-path="files"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="files.read"] .ts-pin'));
        click('[data-tree-path="files.read"] .ts-pin');
        await until(() => document.querySelector('[data-tree-path="files.read"] .ts-pin')?.getAttribute('data-level') === '1');
        assert(warning());
        click('[data-tree-path="files.read"] .ts-pin');
        click('[data-namespace-path="files.nested"] .ts-disable');
        await until(() => !warning());
        click('[data-namespace-path="files.nested"] .ts-disable');
        await until(() => !!warning());
        click('[data-namespace-path="files"] .ts-disable');
        await until(() => !warning());
        click('[data-namespace-path="files"] .ts-disable');
        click('[data-namespace-path="tools"] .ts-disable');
        await until(() => !document.querySelector<HTMLButtonElement>('[data-tree-path="tools.inspect"] .ts-disable')!.disabled);
        click('[data-tree-path="tools.inspect"] .ts-disable');
        await until(() => !warning());
        click('[data-tree-path="files.read"] .ts-pin');
        click('[data-namespace-path="tools"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="files.read"] .ts-disable'));
        const disable = document.querySelector('[data-tree-path="files.read"] .ts-disable')!;
        assert(disable.nextElementSibling!.classList.contains('ts-remove'));
        disable.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await until(() => document.querySelector('[data-tree-path="files.read"]')?.getAttribute('data-tool-status') === 'disabled');
        click('[data-namespace-path="files"] .ts-disable');
        await until(() => document.querySelector('li[data-tree-path="files"]')?.getAttribute('data-disabled') === 'true');
        click('.ts-namespace-profile button[aria-label="Save"]');
        await until(() => registry.snapshot().mappings[0]?.disabled === true && registry.snapshot().namespaces?.[0]?.disabled === true);
        assert(document.querySelector('[data-tree-path="files.read"]'));
        await until(() => document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        document.querySelector('[data-action="save"]')!.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => document.querySelector<HTMLButtonElement>('[data-namespace-path="tools"] .ts-disclosure')?.disabled === false);
        click('[data-namespace-path="files.nested"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="files.nested.read"] .ts-disable'));
        const profileLabel = (): string => document.querySelector('.ts-namespace-profile .ts-profile-label')!.textContent!;
        assert.equal(profileLabel().includes('*'), false);
        for (const selector of [
            '[data-tree-path="files.read"] .ts-disable',
            '[data-namespace-path="files.nested"] .ts-disable',
            '[data-tree-path="files.nested.read"] .ts-disable',
        ]) {
            const button = document.querySelector<HTMLButtonElement>(selector)!;
            assert.equal(button.disabled, true);
            assert.equal(button.getAttribute('aria-pressed'), 'true');
            button.click();
            button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        }
        await delay(30);
        assert.equal(profileLabel().includes('*'), false);
        click('[data-namespace-path="files"] .ts-disable');
        await until(() => document.querySelector<HTMLButtonElement>('[data-tree-path="files.nested.read"] .ts-disable')?.disabled === false);
        assert.equal(document.querySelector('[data-tree-path="files.read"] .ts-disable')?.getAttribute('aria-pressed'), 'true');
        assert.equal(document.querySelector('[data-namespace-path="files.nested"] .ts-disable')?.getAttribute('aria-pressed'), 'false');
        assert.equal(document.querySelector('[data-tree-path="files.nested.read"] .ts-disable')?.getAttribute('aria-pressed'), 'false');
        click('[data-namespace-path="files"] .ts-disable');
        await until(() => document.querySelector<HTMLButtonElement>('[data-tree-path="files.nested.read"] .ts-disable')?.disabled === true);
        click('[data-namespace-path="tools"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="tools.search"] .ts-disable'));
        click('[data-tree-path="tools.search"] .ts-disable');
        await until(() => document.querySelector('[data-tree-path="tools.search"]')?.getAttribute('data-tool-status') === 'disabled');
        click('.ts-namespace-profile button[aria-label="Save"]');
        await until(() => registry.snapshot().builtinDisabled?.includes('tools.search') === true);
        await until(() => document.querySelector('.ts-namespace-profile')?.getAttribute('aria-busy') !== 'true');
        document.querySelector('[data-action="save"]')!.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        click('[data-tree-path="tools.inspect"] .ts-disable');
        await until(() => document.querySelector('[data-tree-path="tools.inspect"]')?.getAttribute('data-tool-status') === 'disabled');
        click('[data-namespace-path="tools"] .ts-disable');
        await until(() => document.querySelector('li[data-tree-path="tools"]')?.getAttribute('data-disabled') === 'true');
        click('.ts-namespace-profile button[aria-label="Save"]');
        await until(() => ['tools', 'tools.inspect'].every(path => registry.snapshot().builtinDisabled?.includes(path)));

    } finally { dom.window.close(); }
});
