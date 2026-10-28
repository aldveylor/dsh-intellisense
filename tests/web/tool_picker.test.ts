import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/web/server/routes.js';
import { managementHtml } from '../../src/web/server/page.js';
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
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        await until(() => !!document.querySelector('[data-unmounted-count]'));
        const namespace = document.querySelector<HTMLElement>('[data-namespace-path="tools"]')!;
        namespace.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
        await until(() => !!document.querySelector('[role="tooltip"] .ts-tool-statistics'));
        const namespaceRows = document.querySelectorAll('[role="tooltip"] .ts-tool-statistics tbody tr');
        assert.equal(namespaceRows.length, 1);
        assert.equal(namespaceRows[0]!.textContent, '总查询次数2');
        const disclosure = namespace.querySelector<HTMLButtonElement>('.ts-disclosure')!;
        disclosure.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        disclosure.focus();
        await until(() => !document.querySelector('[role="tooltip"]'));
        disclosure.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
        disclosure.click();
        assert.equal(document.querySelector('[role="tooltip"]'), null, 'Click focus must not reopen details at the row origin');
        disclosure.blur();
        disclosure.focus();
        await until(() => !!document.querySelector('[role="tooltip"]'));
        disclosure.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        disclosure.blur();
        namespace.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        document.querySelector<HTMLButtonElement>('.ts-open-tools')!.click();
        await until(() => !!document.querySelector('dialog[open]'));
        const order = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('dialog [data-tool-id]:not(:disabled)'), card => card.dataset.toolId!);
        assert.deepEqual(order(), ['zebra', 'alpha', 'beta']);
        assert(document.querySelector('.ts-tool-picker-footer')!.textContent!.includes('3'));
        assert(document.querySelectorAll('dialog .ts-builtin-tool:disabled').length > 0);
        const sort = document.querySelector<HTMLButtonElement>('.ts-tool-sort .ts-tool-filter-trigger')!;
        assert(sort.querySelector('svg'));
        const direction = document.querySelector<HTMLButtonElement>('.ts-tool-sort-direction')!;
        assert(direction.disabled);
        for (const [value, ascending, descending] of [
            ['calls', ['zebra', 'beta', 'alpha'], ['alpha', 'beta', 'zebra']],
            ['queries', ['zebra', 'alpha', 'beta'], ['alpha', 'beta', 'zebra']],
            ['name', ['alpha', 'beta', 'zebra'], ['zebra', 'beta', 'alpha']],
        ] as const) {
            sort.click();
            await until(() => sort.getAttribute('aria-expanded') === 'true');
            const options = document.querySelectorAll<HTMLButtonElement>('.ts-tool-sort [role=menuitemradio]');
            assert.equal(options.length, 4);
            assert(Array.from(options).every(option => option.querySelector('svg')));
            options[['default', 'name', 'calls', 'queries'].indexOf(value)]!.click();
            await until(() => order().join() === ascending.join());
            assert(!direction.disabled);
            assert.equal(direction.getAttribute('aria-pressed'), 'false');
            direction.click();
            await until(() => order().join() === descending.join());
            assert.equal(direction.getAttribute('aria-pressed'), 'true');
            direction.click();
            await until(() => order().join() === ascending.join());
        }
        direction.click();
        sort.click();
        await until(() => sort.getAttribute('aria-expanded') === 'true');
        document.querySelector<HTMLButtonElement>('.ts-tool-sort [role=menuitemradio]')!.click();
        await until(() => order().join() === ['zebra', 'alpha', 'beta'].join());
        assert(direction.disabled);
        assert.equal(direction.getAttribute('aria-pressed'), 'true');
        const groupButton = document.querySelector<HTMLButtonElement>('.ts-tool-group .ts-tool-filter-trigger')!;
        const viewButton = document.querySelector<HTMLButtonElement>('.ts-tool-view .ts-tool-filter-trigger')!;
        assert.equal(document.querySelector('.ts-tool-group')!.getAttribute('data-value'), 'none');
        assert.equal(document.querySelector('.ts-tool-results')!.getAttribute('data-view'), 'cards');
        groupButton.click();
        await until(() => groupButton.getAttribute('aria-expanded') === 'true');
        const groupOptions = document.querySelectorAll<HTMLButtonElement>('.ts-tool-group [role=menuitemradio]');
        assert.equal(groupOptions.length, 3);
        groupOptions[2]!.click();
        await until(() => document.querySelectorAll('.ts-tool-group-heading').length > 0);
        assert(Array.from(document.querySelectorAll('.ts-tool-group-heading')).some(heading => heading.textContent!.includes('Example plugin')));
        assert(Array.from(document.querySelectorAll('.ts-tool-group-heading')).some(heading => heading.textContent!.includes('未知来源')));
        viewButton.click();
        await until(() => viewButton.getAttribute('aria-expanded') === 'true');
        document.querySelectorAll<HTMLButtonElement>('.ts-tool-view [role=menuitemradio]')[1]!.click();
        await until(() => !!document.querySelector('.ts-tool-list'));
        const listRow = document.querySelector<HTMLButtonElement>('dialog [data-tool-id="alpha"]')!;
        assert.equal(listRow.querySelector('.ts-tool-list-source')!.textContent, 'Example plugin');
        assert.equal(listRow.querySelector('.ts-tool-list-description')!.textContent, 'alpha documentation');
        assert.deepEqual(Array.from(listRow.querySelectorAll('.ts-tool-list-count'), cell => cell.textContent), ['2', '2']);
        groupButton.click();
        await until(() => groupButton.getAttribute('aria-expanded') === 'true');
        document.querySelectorAll<HTMLButtonElement>('.ts-tool-group [role=menuitemradio]')[1]!.click();
        await until(() => Array.from(document.querySelectorAll('.ts-tool-group-heading')).some(heading => heading.textContent!.includes('固定工具')));
        assert.deepEqual(order(), ['zebra', 'alpha', 'beta']);
        viewButton.click();
        await until(() => viewButton.getAttribute('aria-expanded') === 'true');
        viewButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await until(() => document.activeElement?.getAttribute('role') === 'menuitemradio');
        document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => viewButton.getAttribute('aria-expanded') === 'false');
        assert.equal(document.activeElement, viewButton);
        assert(document.querySelector('dialog[open]'));
        const card = document.querySelector<HTMLButtonElement>('[data-tool-id="alpha"]')!;
        viewButton.blur();
        await until(() => !document.querySelector('[role="tooltip"]'));
        for (const target of [card, card.querySelector('.ts-tool-list-description')!, card.querySelector('.ts-tool-footer')!, card.querySelector('.ts-tool-list-source')!, card.querySelector('.ts-tool-list-count')!]) {
            target.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
            await delay(20);
            assert(!document.querySelector('[role="tooltip"] .ts-tool-details'));
            target.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        }
        const name = card.querySelector('strong')!;
        name.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
        await until(() => !!document.querySelector('[role="tooltip"]'));
        await until(() => !!document.querySelector('[role="tooltip"] .ts-tool-details h3')?.textContent?.includes('alpha'));
        const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
        for (const line of ['alpha', 'Example plugin', 'alpha documentation', '参数', 'path', 'File path', '返回值', 'content', '总调用次数', '2']) assert(tooltip.textContent!.includes(line), line);
        const queryRow = Array.from(tooltip.querySelectorAll('.ts-tool-statistics tbody tr')).find(row => row.textContent!.includes('总查询次数'));
        assert.equal(queryRow?.querySelector('td')?.textContent, '2');
        assert(!tooltip.textContent!.includes('File content'));
        assert(tooltip.querySelector('.ts-tool-return')!.textContent!.includes('string'));
        const previous = tooltip.style.left;
        name.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 150 }));
        assert.notEqual(tooltip.style.left, previous);
        name.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        card.focus();
        await delay(20);
        assert(!document.querySelector('[role="tooltip"]'));
        name.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));
        await until(() => !!document.querySelector('[role="tooltip"]'));
        card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => !document.querySelector('[role="tooltip"]'));
        assert(document.querySelector('dialog[open]'));
        card.click();
        await until(() => !document.querySelector('dialog'));
        document.querySelector<HTMLButtonElement>('.ts-open-tools')!.click();
        await until(() => !!document.querySelector('dialog[open]'));
        assert.equal(document.querySelector('.ts-tool-results')!.getAttribute('data-view'), 'list');
        assert.equal(document.querySelector('.ts-tool-group')!.getAttribute('data-value'), 'type');
    } finally { dom.window.close(); }
});


test('tool category filter combines selections and keeps the picker open on Escape', async () => {
    const registry = new SemanticRegistry(new MemoryStore());
    registry.refresh(['zebra', 'alpha', 'beta'].map(id => ({ id, description: id, parameters: { type: 'object' }, output: { type: 'string' } })));
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } } } as unknown as Context;
    registerManagement(ctx, registry, { refresh: async () => {} });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true });
    try {
        const { window } = dom;
        const { document } = window;
        window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
        window.structuredClone = structuredClone;
        window.fetch = async url => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), 'http://localhost')));
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        await until(() => document.querySelector<HTMLButtonElement>('.ts-open-tools')?.disabled === false);
        document.querySelector<HTMLButtonElement>('.ts-open-tools')!.click();
        await until(() => !!document.querySelector('dialog[open]'));
        const order = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('dialog [data-tool-id]:not(:disabled)'), card => card.dataset.toolId!);
        const filter = document.querySelector<HTMLButtonElement>('.ts-tool-filter:not(.ts-tool-layout) > .ts-tool-filter-trigger')!;
        assert(filter.querySelector('svg'));
        filter.click();
        await until(() => filter.getAttribute('aria-expanded') === 'true');
        const categories = Array.from(document.querySelectorAll<HTMLButtonElement>('.ts-tool-filter-option'));
        assert.deepEqual(categories.map(input => input.value), ['unmounted', 'mounted', 'fixed']);
        assert(categories.every(input => input.getAttribute('aria-checked') === 'true'));
        categories[2]!.querySelector('span')!.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
        categories[2]!.querySelector('span')!.click();
        await until(() => !document.querySelector('dialog .ts-builtin-tool'));
        assert.equal(categories[2]!.getAttribute('aria-checked'), 'false');
        assert.equal(filter.getAttribute('aria-expanded'), 'true');
        categories[0]!.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
        categories[0]!.click();
        await until(() => order().length === 0);
        assert.equal(filter.getAttribute('aria-expanded'), 'true');
        assert.equal(document.querySelectorAll('dialog [data-tool-id]').length, 0);
        categories[0]!.click();
        await until(() => order().length === 3);
        categories[2]!.click();
        await until(() => order().length === 3 && !!document.querySelector('dialog .ts-builtin-tool'));
        categories[0]!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => filter.getAttribute('aria-expanded') === 'false');
        assert.equal(document.activeElement, filter);
        assert(document.querySelector('dialog[open]'));
        filter.click();
        await until(() => filter.getAttribute('aria-expanded') === 'true');
        for (const option of document.querySelectorAll<HTMLButtonElement>('.ts-tool-filter-option')) {
            option.click();
            await until(() => option.getAttribute('aria-checked') === 'false');
        }
        await until(() => document.querySelectorAll('dialog [data-tool-id]').length === 0);
        document.querySelector<HTMLButtonElement>('.ts-tool-picker header button')!.click();
        await until(() => !document.querySelector('dialog'));
        document.querySelector<HTMLButtonElement>('.ts-open-tools')!.click();
        await until(() => !!document.querySelector('dialog[open]'));
        assert.equal(document.querySelectorAll('dialog [data-tool-id]').length, 0);
    } finally { dom.window.close(); }
});
