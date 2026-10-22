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

test('fixed namespaces reject mutation and incoming drops while unknown tools can leave', () => {
    const state = draft();
    for (const path of ['vm', 'unknown']) {
        assert.throws(() => renameNamespace(state, path, 'other'), /固定/);
        assert.throws(() => deleteNamespace(state, path), /固定/);
        assert.throws(() => dropTree(state, { namespace: true, path }, { path: 'std', position: 'inside' }), /不可移动/);
        assert.throws(() => dropTree(state, { namespace: false, id: 'write', path: 'std.write' }, { path, position: 'inside' }), /不能拖入/);
        assert.throws(() => dropTree(state, { namespace: false, id: 'write', path: 'std.write' }, { path: `${path}.print`, position: 'before' }), /不能拖入/);
    }
    assert.throws(() => dropTree(state, { namespace: false, id: 'print', path: 'vm.print' }, { path: '', position: 'inside' }), /不可移动/);
    const moved = dropTree(state, { namespace: false, id: 'read', path: 'unknown.read' }, { path: 'std', position: 'inside' });
    assert.equal(moved.mappings.find(mapping => mapping.id === 'read')?.path, 'std.read');
    assert(!moved.namespaces.some(namespace => namespace.path === 'unknown'));
    assert(!state.mappings.some(mapping => mapping.id === 'read'));
});

test('vm and unknown use namespace blocks; only unknown child tools can drag out', async () => {
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
            if (options?.body) { saves.push(JSON.parse(String(options.body))); return Response.json({ ok: true }); }
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
        header('std').querySelector<HTMLButtonElement>('.ts-disclosure')!.click();
        await until(() => document.querySelectorAll('[data-vm-builtin]').length === 2);
        assert.equal(document.querySelector('[data-vm-builtin="vm.print"] code')!.textContent, 'print');
        for (const command of document.querySelectorAll('[data-vm-builtin]')) {
            assert(command.classList.contains('ts-fixed-node'));
            assert.equal(command.closest('ul')!.parentElement!.getAttribute('data-tree-path'), 'vm');
            assert.equal(command.querySelector('button,input,[role=button]'), null);
            assert.equal(command.getAttribute('draggable'), null);
        }
        const source = document.querySelector<HTMLElement>('[data-tree-path="unknown.read_file"]')!;
        assert.equal(source.draggable, true);
        assert.equal(source.querySelector('button,input,[role=button]'), null);
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
        dragEvent('dragstart', source);
        dragEvent('drop', document.querySelector('.ts-namespace-placeholder[data-namespace-path=""]')!);
        await until(() => document.querySelector('[data-tree-path="read_file"]') !== null);
        assert.equal(document.querySelector('[data-tree-path="unknown.read_file"]'), null);
        const mapped = document.querySelector('[data-tree-path="std.write"]')!;
        dragEvent('dragstart', mapped);
        for (const path of ['unknown', 'vm']) dragEvent('drop', header(path));
        assert(document.querySelector('[data-tree-path="std.write"]'));
        assert.equal(document.querySelector('[data-tree-path="unknown.write"]'), null);
        const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '保存配置')!;
        save.click(); await until(() => saves.length === 1);
        assert(!saves[0].namespaces.some((namespace: { path: string }) => ['vm', 'unknown'].includes(namespace.path)));
        assert.equal(saves[0].mappings.find((mapping: { id: string }) => mapping.id === 'read_file').path, 'read_file');
    } finally { dom.window.close(); }
});
