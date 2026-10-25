import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Wait for a React update or a saved Profile response. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await delay(10); }
    assert(predicate(), 'Expected disabled tree transition');
}

test('disable controls retain visible nodes, precede deletion and save command and namespace state', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh([{ id: 'read', description: 'Read document', parameters: { type: 'object' }, output: { type: 'string' } }]);
    await registry.configure([{ id: 'read', path: 'files.read', aliases: [], pinned: false }], 0, [{ path: 'files', description: 'Files', alwaysVisible: false }]);
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } }, emit: () => {} } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import { createRoot } from 'react-dom/client';
        import { ManagementPanel } from './src/management/panel/management_panel.js';
        createRoot(document.getElementById('root')).render(<ManagementPanel api='/api/ts-intellisense-state' />);
    ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, write: false });
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/', runScripts: 'outside-only', virtualConsole });
    dom.window.structuredClone = structuredClone;
    dom.window.fetch = async (url, init) => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), dom.window.location.href), { ...init as RequestInit, signal: undefined }));
    const document = dom.window.document;
    const click = (selector: string): void => document.querySelector<HTMLButtonElement>(selector)!.click();
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        await until(() => !!document.querySelector('[data-namespace-path="files"] .ts-disclosure'));
        click('[data-namespace-path="files"] .ts-disclosure');
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
        await until(() => document.querySelector<HTMLButtonElement>('[data-namespace-path="tools"] .ts-disclosure')?.disabled === false);
        click('[data-namespace-path="tools"] .ts-disclosure');
        await until(() => !!document.querySelector('[data-tree-path="tools.search"] .ts-disable'));
        click('[data-tree-path="tools.search"] .ts-disable');
        await until(() => document.querySelector('[data-tree-path="tools.search"]')?.getAttribute('data-tool-status') === 'disabled');
        click('.ts-namespace-profile button[aria-label="Save"]');
        await until(() => registry.snapshot().builtinDisabled?.includes('tools.search') === true);
    } finally { dom.window.close(); }
});
