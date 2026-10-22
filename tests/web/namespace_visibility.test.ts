import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { deleteNamespace, dropTree, renameNamespace, type TreeDraft } from '../../src/web/namespace_tree.js';
import { managementHtml } from '../../src/web/ui.js';

/** @brief Wait for committed React state rather than relying on one render tick. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (predicate()) return;
        await delay(10);
    }
    assert(predicate(), 'Expected namespace state was not rendered');
}

/** @brief The editable draft deliberately excludes the two synthetic namespaces. */
function draft(): TreeDraft {
    return {
        mappings: [{ id: 'write', path: 'std.write', aliases: [], enabled: true, pinned: false }],
        namespaces: [{ path: 'std', description: '', alwaysVisible: false }], order: ['std', 'std.write'],
    };
}

test('namespace command counts and visibility pins follow fixed and unknown policies', async () => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) throw error; });
    const dom = new JSDOM(managementHtml, { url: 'http://localhost/api/ts-intellisense', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    try {
        const { window } = dom;
        const state = draft();
        const view = {
            state: { version: 1, revision: 1, usage: {}, ...state },
            tools: [
                { id: 'read_file', description: 'Read a file', parameters: { type: 'object' }, output: { type: 'string' } },
                { id: 'write', description: 'Write a file', parameters: { type: 'object' }, output: { type: 'string' } },
            ],
            effective: [{ id: 'read_file', path: 'unknown.read_file' }, { id: 'write', path: 'std.write' }],
            declarations: '', sessions: [],
        };
        const saves: any[] = [];
        window.structuredClone = structuredClone;
        window.fetch = async (_url: unknown, options?: RequestInit) => {
            if (options?.body) {
                const body = JSON.parse(String(options.body)); saves.push(body);
                Object.assign(view.state, { mappings: body.mappings, namespaces: body.namespaces, order: body.order, unknownVisible: body.unknownVisible });
                view.state.revision++;
                return Response.json({ ok: true });
            }
            return Response.json(view);
        };
        window.eval(await readFile(new URL('../../dist/web/standalone.js', import.meta.url), 'utf8'));
        const document = window.document;
        await until(() => document.querySelector('.ts-node-block[data-namespace-path="std"]') !== null);
        const header = (path: string) => document.querySelector<HTMLElement>(`.ts-node-block[data-namespace-path="${path}"]`)!;
        for (const path of ['vm', 'unknown']) {
            const block = header(path);
            assert(block.classList.contains('ts-fixed-node'));
            assert.equal(block.draggable, false);
            assert.equal(block.querySelectorAll('button').length, 1, 'only disclosure is interactive');
            block.querySelector('.ts-node-name')!.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
            assert.equal(block.querySelector('input,[role=button]'), null);
            block.querySelector<HTMLButtonElement>('.ts-disclosure')!.click();
        }
        assert.equal(document.querySelector('[aria-label="vm 命令数"]')!.textContent, '2');
        assert.equal(document.querySelector('[aria-label="unknown 命令数"]')!.textContent, '1');
        assert.equal(document.querySelector('[aria-label="std 命令数"]')!.textContent, '1');
        assert(!document.body.textContent!.includes('个未挂载工具'));
        assert(!document.body.textContent!.includes('仅可拖出'));
        header('std').querySelector<HTMLButtonElement>('.ts-disclosure')!.click();
        await until(() => document.querySelectorAll('[data-tree-path^="vm."]').length === 2);
        assert.equal(document.querySelector('[data-tree-path="vm.print"] code')!.textContent, 'print');
        for (const command of document.querySelectorAll('[data-tree-path^="vm."]')) {
            assert(command.classList.contains('ts-fixed-node'));
            assert.equal(command.closest('ul')!.parentElement!.getAttribute('data-tree-path'), 'vm');
            assert.equal(command.querySelector('input,[role=button]'), null);
            const pin = command.querySelector<HTMLButtonElement>('.ts-pin')!;
            assert(pin.disabled); assert.equal(pin.getAttribute('aria-pressed'), 'true');
            assert.equal(pin.title, '内置指令始终固定显示');
            pin.click(); assert.equal(pin.getAttribute('aria-pressed'), 'true');
            assert.equal((command as HTMLElement).draggable, false);
            assert(command.getAttribute('title'));
            assert.equal(command.querySelector('.ts-tool-preview')!.getAttribute('title'), command.getAttribute('title'));
            assert(command.querySelector('code')!.getAttribute('title')!.includes(command.getAttribute('title')!));
        }
        const source = document.querySelector<HTMLElement>('[data-tree-path="unknown.read_file"]')!;
        assert.equal(source.draggable, true);
        assert.equal(source.querySelector('input,[role=button]'), null);
        const unknownPin = source.querySelector<HTMLButtonElement>('.ts-pin')!;
        assert(!unknownPin.disabled); assert.equal(unknownPin.getAttribute('aria-pressed'), 'false');
        unknownPin.click(); await until(() => unknownPin.getAttribute('aria-pressed') === 'true');
        const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '保存配置')!;
        save.click(); await delay(20); await until(() => saves.length === 1 && !save.disabled);
        assert.deepEqual(saves[0].unknownVisible, ['read_file']);
        assert(!saves[0].mappings.some((mapping: { id: string }) => mapping.id === 'read_file'));
        assert.equal(document.querySelector('.ts-namespace-placeholder[data-namespace-path="unknown"]'), null);
        const payload = new Map<string, string>();
        const transfer = { getData: (key: string) => payload.get(key) ?? '', setData: (key: string, value: string) => payload.set(key, value), get types() { return [...payload.keys()]; }, effectAllowed: 'move' };
        /** @brief Drive the supported native drag entry through its actual React handlers. */
        const dragEvent = (type: string, target: Element) => {
            const event = new window.Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'dataTransfer', { value: transfer });
            Object.defineProperty(event, 'clientY', { value: 0 });
            target.dispatchEvent(event);
        };
        dragEvent('dragstart', document.querySelector('[data-tree-path="unknown.read_file"]')!);
        dragEvent('drop', document.querySelector('.ts-namespace-placeholder[data-namespace-path="std"]')!);
        await until(() => document.querySelector('[data-tree-path="std.read_file"]') !== null).catch(error => { throw new Error(`${error}; payload=${JSON.stringify([...payload])}; status=${document.querySelector('[role=status]')?.textContent}`); });
        assert.equal(document.querySelector('[data-tree-path="unknown.read_file"]'), null);
        assert.equal(document.querySelector('[aria-label="unknown 命令数"]')!.textContent, '0');
        assert.equal(document.querySelector('[aria-label="std 命令数"]')!.textContent, '2');
        assert.equal(document.querySelector('[data-tree-path="std.read_file"] .ts-pin')!.getAttribute('aria-pressed'), 'true');
        const mapped = document.querySelector('[data-tree-path="std.write"]')!;
        dragEvent('dragstart', mapped);
        for (const path of ['unknown', 'vm']) dragEvent('drop', header(path));
        assert(document.querySelector('[data-tree-path="std.write"]'));
        assert.equal(document.querySelector('[data-tree-path="unknown.write"]'), null);

        save.click(); await delay(20); await until(() => saves.length === 2 && !save.disabled);
        assert(!saves[1].namespaces.some((namespace: { path: string }) => ['vm', 'unknown'].includes(namespace.path)));
        assert.equal(saves[1].mappings.find((mapping: { id: string }) => mapping.id === 'read_file').path, 'std.read_file');
        assert.deepEqual(saves[1].unknownVisible, []);
    } finally { dom.window.close(); }
});
