import { createNamespace } from '../../src/namespace/namespace.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { browserLanguage, translate } from '../../src/management/locale/locale.js';
import { managementHtml } from '../../src/management/server/page.js';

/** @brief Wait for a committed browser render. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'Expected localized UI was not rendered');
}

/** @brief Supply a minimal editor response with untrusted external tool documentation. */
const view = {
    provided: createNamespace({ tools: [], includeUnavailable: true }).serialize().children,
    state: { version: 1, revision: 1, mappings: [], namespaces: [], usage: {}, profile: 'Default', profiles: ['Default'] },
    tools: [{ id: 'read', description: '<b>工具原始说明</b>', parameters: {} }], effective: [], declarations: '', sessions: [],
};

/** @brief Isolate browser state and ignore jsdom's unsupported modern stylesheet syntax. */
function browser(): JSDOM {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', virtualConsole });
    dom.window.structuredClone = structuredClone;
    dom.window.fetch = async () => Response.json(view);
    return dom;
}

test('browser locale matching, interpolation and namespace errors use the requested language', () => {
    assert.equal(browserLanguage(['fr-FR', 'en-US', 'zh-CN']), 'en');
    assert.equal(browserLanguage(['zh-TW', 'en-US']), 'zh');
    assert.equal(browserLanguage(['ja']), 'en');
    assert.equal(translate('en-US')('mapping_name', { path: 'std.read' }), 'Mapping name std.read');
    assert.equal(translate('en-US')('namespace_cycle'), 'Cannot move a namespace into itself or a descendant.');
    assert.equal(translate('zh-CN')('save'), '保存');
    assert.equal(translate('en-US')('<b>工具原始说明</b>'), '<b>工具原始说明</b>');
    assert.equal(translate('en-US')('toString'), 'toString');
});

test('standalone page selects Chinese or American English and updates document metadata', async () => {
    const script = await readFile(new URL('../../dist/management/standalone.js', import.meta.url), 'utf8');
    for (const [language, title, lang] of [['zh-CN', '工具命名空间表', 'zh-CN'], ['en-US', 'Tool Namespace Table', 'en-US']]) {
        const dom = browser();
        try {
            Object.defineProperty(dom.window.navigator, 'languages', { value: [language] });
            dom.window.eval(script);
            await until(() => dom.window.document.querySelector('h1')?.textContent === title);
            assert.equal(dom.window.document.documentElement.lang, lang);
            assert.equal(dom.window.document.title, translate(language!)('page_title'));
            assert.equal(dom.window.document.querySelector('h2')?.textContent, translate(language!)('namespace_tree'));
        } finally { dom.window.close(); }
    }
});

test('host language switches update an open editor while preserving its unsaved input', async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), sourcefile: 'locale_harness.tsx', loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { NativePanel } from './src/management/locale/native_panel.js';
            import { translate } from './src/management/locale/locale.js';
            let snapshot = { active: 'zh', revision: 1, locales: [] };
            const listeners = new Set();
            const locale = {
                getSnapshot: () => snapshot,
                subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
                bind: () => (key, values) => translate(snapshot.active)(key, values),
            };
            window.switchLanguage = () => {
                snapshot = { ...snapshot, active: snapshot.active === 'zh' ? 'en' : 'zh', revision: snapshot.revision + 1 };
                listeners.forEach(listener => listener());
            };
            createRoot(document.getElementById('root')).render(<NativePanel api='/api/ts-intellisense-state' locale={locale} />);
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, write: false,
    });
    const dom = browser();
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        const document = dom.window.document;
        await until(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '新建 Profile' && !button.disabled));
        Array.from(document.querySelectorAll('button')).find(button => button.textContent === '新建 Profile')!.click();
        await until(() => !!document.querySelector('input[aria-label="Profile 名称"]'));
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Profile 名称"]')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Unsaved profile');
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        (dom.window as unknown as { switchLanguage(): void }).switchLanguage();
        await until(() => document.querySelector('h1')?.textContent === 'Tool Namespace Table');
        assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')?.value, 'Unsaved profile');
        assert(document.body.textContent?.includes('Native console output'));
        assert(document.body.textContent?.includes('1 unmounted tools'));
        (dom.window as unknown as { switchLanguage(): void }).switchLanguage();
        await until(() => document.querySelector('h1')?.textContent === '工具命名空间表');
        assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="Profile 名称"]')?.value, 'Unsaved profile');
    } finally { dom.window.close(); }
});
