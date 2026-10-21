import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ManagementPanel } from '../../src/web/management_panel.js';

test('VM commands are always visible as fixed blocks without edit, delete or drag controls', () => {
    const markup = renderToStaticMarkup(createElement(ManagementPanel, { api: '/api/ts-intellisense-state' }));
    const dom = new JSDOM(markup.replace(/<style>[\s\S]*?<\/style>/g, ''));
    try {
        const blocks = dom.window.document.querySelectorAll('[data-vm-builtin]');
        assert.equal(blocks.length, 2);
        assert.deepEqual(Array.from(blocks).map(block => block.getAttribute('data-vm-builtin')), ['vm.print', 'vm.restart']);
        for (const block of blocks) {
            assert.equal(block.querySelector('input,button,[draggable=true],[role=button]'), null);
            assert.equal(block.getAttribute('draggable'), null);
            assert.match(block.textContent!, /内置 · 只读/);
        }
    } finally { dom.window.close(); }
});
