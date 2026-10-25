import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showTreeDropFeedback, clearTreeDropFeedback } from '../../src/management/panel/tree_drag.js';

test('namespace insertion markers follow the complete subtree and inside drops highlight only the header', () => {
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
        const marker = document.querySelector<HTMLElement>('.ts-drop-insertion')!;
        assert.equal(marker.style.top, '110px');
        assert.equal(marker.style.width, '200px');
        showTreeDropFeedback(header, 20);
        assert.equal(header.dataset.dropEdge, 'inside');
        assert.equal(document.querySelector('.ts-drop-insertion'), null);
        clearTreeDropFeedback();
        assert.equal(header.dataset.dropEdge, undefined);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
        dom.window.close();
    }
});
