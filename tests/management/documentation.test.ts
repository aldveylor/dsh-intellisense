import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import type { Context } from '@deepseek-ai/cordis';
import { registerManagement } from '../../src/management/server/routes.js';
import { managementHtml } from '../../src/management/server/page.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Mount documentation and state routes without a live DSH instance. */
function fixture() {
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const ctx = { connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route.fetch) } } } as unknown as Context;
    registerManagement(ctx, new SemanticRegistry(new MemoryStore()), { refresh: async () => {} });
    return routes;
}

/** @brief Await a committed guide or management view in the standalone client. */
async function until(predicate: () => boolean): Promise<void> {
    for (let count = 0; count < 100 && !predicate(); count++) await delay(10);
    assert(predicate());
}

test('documentation images accept only supported languages and screenshot names', async () => {
    const route = fixture().get('/api/ts-intellisense-docs-image')!;
    const image = await route(new Request('http://localhost/api/ts-intellisense-docs-image?language=en&name=tools'));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71]);
    for (const language of ['en', 'zh']) {
        for (const name of ['profile_editor', 'namespace_tree', 'new_conversation']) {
            const screenshot = await route(new Request(`http://localhost/api/ts-intellisense-docs-image?language=${language}&name=${name}`));
            assert.equal(screenshot.status, 200);
            assert.equal(screenshot.headers.get('content-type'), 'image/png');
        }
    }
    for (const query of ['language=en&name=../../package', 'language=../&name=tools', 'language=en&name=tools&path=package.json', 'name=tools']) {
        assert.equal((await route(new Request(`http://localhost/api/ts-intellisense-docs-image?${query}`))).status, 404);
    }
});

test('the configuration page opens localized bundled usage documentation and screenshot URLs', async () => {
    for (const { language, viewed } of [{ language: 'en', viewed: false }, { language: 'zh', viewed: false }, { language: 'zh', viewed: true }]) {
        const routes = fixture();
        const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true });
        try {
            const { window } = dom;
            if (viewed) window.localStorage.setItem('ts-intellisense:usage-guide-viewed', 'true');
            Object.defineProperty(window.navigator, 'languages', { value: [language] });
            window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
            window.structuredClone = structuredClone;
            window.fetch = async url => routes.get('/api/ts-intellisense-state')!(new Request(new URL(String(url), 'http://localhost')));
            window.eval(await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8'));
            await until(() => !!window.document.querySelector('.ts-panel-header button'));
            const help = window.document.querySelector<HTMLButtonElement>('.ts-panel-header button')!;
            assert.equal(help.previousElementSibling?.tagName, 'H1');
            assert.equal(help.getAttribute('aria-label'), language === 'zh' ? '使用文档' : 'Usage guide');
            assert(help.querySelector('svg'));
            assert.equal(help.textContent, '');
            assert.equal(!!help.querySelector('.ts-usage-unread'), !viewed);
            help.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 }));
            await until(() => !!window.document.querySelector('[role="tooltip"] .ts-action-hint'));
            const hint = window.document.querySelector('.ts-action-hint')!;
            assert.equal(hint.querySelector('strong')!.textContent, language === 'zh' ? '使用文档' : 'Usage guide');
            assert(hint.querySelector('span')!.textContent!.length > 10);
            assert.equal(help.getAttribute('title'), null, 'Use styled hints instead of a duplicate browser tooltip');
            help.click();
            await until(() => !!window.document.querySelector('.ts-usage-dialog[open]'));
            assert.equal(help.querySelector('.ts-usage-unread'), null);
            assert.equal(window.localStorage.getItem('ts-intellisense:usage-guide-viewed'), 'true');
            const guide = window.document.querySelector('.ts-usage-dialog')!;
            assert.equal(guide.querySelector('h2')!.textContent, language === 'zh' ? '使用文档' : 'Usage guide');
            assert(guide.textContent!.includes(language === 'zh' ? 'Agent 能看到什么' : 'What the agent can see'));
            assert(!guide.textContent!.includes('commands.paths'));
            assert(!guide.textContent!.includes('ProfileWrite'));
            assert.deepEqual(Array.from(guide.querySelectorAll('img'), image => new URL(image.src).searchParams.get('name')),
                ['profile_editor', 'tools', 'namespace_tree', 'tooltip', 'new_conversation']);
            const conversation = guide.querySelector<HTMLImageElement>('img[src*="name=new_conversation"]')!;
            let heading: Element | null = conversation.previousElementSibling;
            while (heading && heading.tagName !== 'H3') heading = heading.previousElementSibling;
            assert.equal(heading?.textContent, language === 'zh' ? '在对话中使用配置' : 'Use a Profile in a conversation');
            assert(guide.querySelector('img')!.src.includes(`language=${language}`));
            guide.querySelector<HTMLButtonElement>('button')!.click();
            await until(() => !window.document.querySelector('.ts-usage-dialog'));
            assert.equal(help.querySelector('.ts-usage-unread'), null);
        } finally { dom.window.close(); }
    }
});
