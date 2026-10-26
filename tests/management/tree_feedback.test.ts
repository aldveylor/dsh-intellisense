import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showTreeDropFeedback, clearTreeDropFeedback, treeDropTarget } from '../../src/management/panel/tree_drag.js';

test('insertion reserves a sibling slot after the complete subtree and inside drops clear the slot', () => {
    const dom = new JSDOM('<ul class="ts-tree"><li id="namespace"><div id="header" class="ts-node-block" data-namespace-path="files"></div><ul><li>child</li></ul></li><li id="next" class="ts-tree-tool" data-tree-path="read"></li></ul>');
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    try {
        const document = dom.window.document;
        const header = document.getElementById('header')!;
        const namespace = document.getElementById('namespace')!;
        const next = document.getElementById('next')!;
        header.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 5, width: 200, height: 20 } as DOMRect);
        namespace.getBoundingClientRect = () => ({ top: 10, bottom: 100, left: 5, width: 200, height: 90 } as DOMRect);
        next.getBoundingClientRect = () => ({ top: 120, bottom: 140, left: 5, width: 200, height: 20 } as DOMRect);
        showTreeDropFeedback(header, 29);
        const gap = document.querySelector<HTMLElement>('.ts-drop-gap')!;
        assert(gap);
        assert.equal(namespace.nextElementSibling, gap);
        assert.equal(gap.nextElementSibling, next);
        assert.equal(gap.style.height, '44px');
        assert.deepEqual(treeDropTarget(gap, 110), { path: 'files', position: 'after' });
        showTreeDropFeedback(gap, 110);
        assert.equal(document.querySelector('.ts-drop-gap'), gap);
        assert.equal(document.querySelector('.ts-drop-insertion'), null);
        showTreeDropFeedback(header, 29);
        assert.equal(document.querySelector('.ts-drop-gap'), gap, 'Repeated pointer frames retain the same slot');
        showTreeDropFeedback(header, 20);
        assert.equal(header.dataset.dropEdge, 'inside');
        assert.equal(document.querySelector('.ts-drop-gap'), null);
        showTreeDropFeedback(header, 11);
        assert.equal(namespace.previousElementSibling?.className, 'ts-drop-gap');
        clearTreeDropFeedback();
        assert.equal(header.dataset.dropEdge, undefined);
        assert.equal(document.querySelector('.ts-drop-gap'), null);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
        dom.window.close();
    }
});
