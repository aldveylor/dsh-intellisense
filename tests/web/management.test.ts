import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { JSDOM } from 'jsdom';
import { managementHtml } from '../../src/web/ui.js';

/** @brief Wait for actual React commits and asynchronous API work without depending on render timing. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'React UI did not reach the expected state');
}

test('native bundle registers the shared React editor in Plugins settings using the mounted app base', async () => {
    let entry: { id: string; factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void; inject: string[] } } | undefined;
    runInNewContext(await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
        window: { __ModuleLoader__: { load: (value: typeof entry) => { entry = value; } } },
        document: { baseURI: 'http://localhost/work/' }, URL,
    });
    assert(entry);
    assert.equal(entry.id, 'dsh-ts-intellisense');
    const module = entry.factory(id => {
        if (id === 'react') return React;
        if (id === 'react/jsx-runtime') return jsxRuntime;
        throw new Error(`Unexpected browser dependency: ${id}`);
    });
    assert.deepEqual(Array.from(module.inject), ['slots']);
    let registered = false;
    module.apply({ slots: {
        inject: (name: string, install: () => void) => { assert.equal(name, 'settings.plugins.tab'); install(); },
        register: (options: { name: string; id: string; inject: () => { api: string } }, component: unknown) => {
            assert.equal(options.name, 'settings.plugins.tab');
            assert.equal(options.id, 'ts-intellisense');
            assert.equal(options.inject().api, 'http://localhost/work/api/ts-intellisense-state');
            assert.equal(typeof component, 'function'); registered = true;
        },
    } });
    assert(registered);
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.exports['./client'].default, './dist/client.js');
    assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'));
});

test('standalone React editor loads safely, saves versioned drafts and requires explicit proposal approval', async () => {
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only' });
    try {
        const { window } = dom;
        const requests: Array<Record<string, unknown>> = [];
        const tool = { id: 'read', description: '<img src=x onerror=alert(1)>', parameters: { type: 'object' }, output: { type: 'string' } };
        const view = {
            state: { version: 1, revision: 2, mappings: [] as Array<Record<string, unknown>>, usage: {} },
            tools: [tool], effective: [{ ...tool, tool, path: 'unknown.read', aliases: [], enabled: true, pinned: false }],
            declarations: '', sessions: [{ id: 'ts-session' }],
        };
        let rejectSave = true;
        window.structuredClone = structuredClone;
        window.fetch = async (url: string | URL | Request, options?: RequestInit) => {
            assert.equal(String(url), 'http://localhost/api/ts-intellisense-state');
            assert.equal(options?.credentials, 'same-origin');
            if (!options?.body) return Response.json(view);
            const body = JSON.parse(String(options.body)); requests.push(body);
            if (body.action === 'configure') {
                assert.equal(body.revision, 2);
                if (rejectSave) return Response.json({ error: 'Registry revision conflict' }, { status: 400 });
                view.state.mappings = body.mappings; view.state.revision++;
            }
            if (body.action === 'organize') return Response.json({ id: 'proposal-1', proposal: { revision: 3, changes: [] } });
            return Response.json({ ok: true });
        };
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        const document = window.document;
        await until(() => document.querySelector('[role=status]')?.textContent?.includes('修订 2') === true);
        assert.equal(document.querySelector('td p')?.textContent, tool.description);
        assert.equal(document.querySelector('td img'), null);
        /** @brief Simulate real browser typing through React's controlled input tracking. */
        const type = (label: string, value: string) => {
            const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
        };
        /** @brief Click the visible React button by its accessible text. */
        const click = (label: string) => {
            const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === label)!;
            assert(button && !button.disabled); button.click();
        };
        type('语义路径 read', 'std.fs.read');
        type('别名 read', 'files.read, ');
        await delay(0);
        assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="别名 read"]')!.value, 'files.read, ');
        type('别名 read', 'files.read, data.read');
        await delay(0);
        click('保存配置');
        await until(() => document.querySelector('[role=status]')?.textContent === 'Registry revision conflict');
        assert.equal(document.querySelector<HTMLInputElement>('input[aria-label="语义路径 read"]')!.value, 'std.fs.read');
        rejectSave = false;
        click('保存配置');
        await until(() => document.querySelector('[role=status]')?.textContent?.includes('修订 3') === true);
        assert.deepEqual(view.state.mappings[0]?.aliases, ['files.read', 'data.read']);
        assert.equal(view.state.mappings[0]?.path, 'std.fs.read');
        click('生成整理提案');
        await until(() => !!document.querySelector('[role=dialog]'));
        assert.equal(requests.filter(body => body.action === 'approve').length, 0);
        assert.equal(requests.at(-1)?.sessionId, 'ts-session');
        click('校验并应用');
        await until(() => !document.querySelector('[role=dialog]'));
        assert.equal(requests.at(-1)?.action, 'approve');
        assert.equal(requests.at(-1)?.id, 'proposal-1');
    } finally { dom.window.close(); }
});
