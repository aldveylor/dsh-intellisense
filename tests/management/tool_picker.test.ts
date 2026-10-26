import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
import { managementHtml } from '../../src/management/server/page.js';
import { CommandStatistics } from '../../src/namespace/statistics.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Wait for the bundled React UI to commit a browser interaction. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'Expected tool picker state');
}

test('picker and namespace details show global call and query counts', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh(['zebra', 'alpha', 'beta'].map(id => ({ id, source: id === 'alpha' ? 'Example plugin' : undefined,
        description: `${id} documentation`, parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } } },
        output: { type: 'object', properties: { content: { type: 'string', description: 'File content' } } },
    })));
    const statistics = new CommandStatistics(new MemoryStore());
    await statistics.recordCall('first', 'alpha');
    await statistics.recordCall('second', 'alpha');
    await statistics.recordCall('first', 'beta');
    await statistics.recordQueries('first', [
        { path: 'std.alpha', namespace: false, tool: 'alpha' },
        { path: 'tools', namespace: true },
    ]);
    await statistics.recordQueries('second', [
        { path: 'other.alpha', namespace: false, tool: 'alpha' },
        { path: 'std.beta', namespace: false, tool: 'beta' },
        { path: 'std.beta', namespace: false, tool: 'beta' },
        { path: 'tools', namespace: true },
    ]);
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } } } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {}, statistics });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true });
    try {
        const { window } = dom;
        const { document } = window;
        Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN'] });
        window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
        window.structuredClone = structuredClone;
        window.fetch = async url => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), 'http://localhost')));
        window.eval(await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8'));
        await until(() => !!document.querySelector('[data-unmounted-count]'));
        const namespace = document.querySelector<HTMLElement>('[data-namespace-path="tools"]')!;
        namespace.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
        await until(() => !!document.querySelector('[role="tooltip"] .ts-tool-statistics'));
        const namespaceRows = document.querySelectorAll('[role="tooltip"] .ts-tool-statistics tbody tr');
        assert.equal(namespaceRows.length, 1);
        assert.equal(namespaceRows[0]!.textContent, '总查询次数2');
        namespace.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        document.querySelector<HTMLButtonElement>('[data-unmounted-count]')!.click();
        await until(() => !!document.querySelector('dialog[open]'));
        const order = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('dialog [data-tool-id]:not(:disabled)'), card => card.dataset.toolId!);
        assert.deepEqual(order(), ['zebra', 'alpha', 'beta']);
        assert(document.querySelector('.ts-tool-picker-footer')!.textContent!.includes('3'));
        assert(document.querySelectorAll('dialog .ts-builtin-tool:disabled').length > 0);
        const sort = document.querySelector<HTMLButtonElement>('.ts-tool-picker-sort .ts-profile-select > button')!;
        for (const [value, expected] of [
            ['calls_desc', ['alpha', 'beta', 'zebra']], ['calls_asc', ['zebra', 'beta', 'alpha']],
            ['queries_desc', ['alpha', 'beta', 'zebra']], ['queries_asc', ['zebra', 'alpha', 'beta']],
            ['name_asc', ['alpha', 'beta', 'zebra']], ['name_desc', ['zebra', 'beta', 'alpha']],
            ['default', ['zebra', 'alpha', 'beta']],
        ] as const) {
            sort.click();
            await until(() => sort.getAttribute('aria-expanded') === 'true');
            const options = document.querySelectorAll<HTMLButtonElement>('.ts-tool-picker-sort .ts-profile-option');
            options[['default', 'name_asc', 'name_desc', 'calls_desc', 'calls_asc', 'queries_desc', 'queries_asc'].indexOf(value)]!.click();
            await until(() => order().join() === expected.join());
        }
        const card = document.querySelector<HTMLButtonElement>('[data-tool-id="alpha"]')!;
        card.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
        await until(() => !!document.querySelector('[role="tooltip"]'));
        const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
        for (const line of ['alpha', 'Example plugin', 'alpha documentation', '参数', 'path', 'File path', '返回值', 'content', '总调用次数', '2']) assert(tooltip.textContent!.includes(line), line);
        const queryRow = Array.from(tooltip.querySelectorAll('.ts-tool-statistics tbody tr')).find(row => row.textContent!.includes('总查询次数'));
        assert.equal(queryRow?.querySelector('td')?.textContent, '2');
        assert(!tooltip.textContent!.includes('File content'));
        assert(tooltip.querySelector('.ts-tool-return')!.textContent!.includes('string'));
        const previous = tooltip.style.left;
        card.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 150 }));
        assert.notEqual(tooltip.style.left, previous);
        card.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        card.focus();
        await until(() => !!document.querySelector('[role="tooltip"]'));
        card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        assert(document.querySelector('dialog[open]'));
        card.click();
        await until(() => !document.querySelector('dialog'));
    } finally { dom.window.close(); }
});
