import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/** @brief Verify shared editing keeps measured dimensions and respects commit/cancel semantics. */
test('inline editors preserve display dimensions across editing and reject invalid drafts', async () => {
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { EditableText } from './src/management/controls/editable_text.js';
            window.flush = flushSync;
            window.commits = [];
            flushSync(() => createRoot(document.getElementById('root')).render(<>
                <EditableText value='Name' label='Name' commit={value => {
                    window.commits.push(value); return value !== 'invalid';
                }} />
                <EditableText value='Profile' label='Profile' commit={value => window.commits.push(value)}
                    renderDisplay={beginEdit => <button onDoubleClick={event => beginEdit(event.currentTarget)}>Profile</button>} />
            </>));
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    });
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    const document = window.document;
    try {
        window.eval(bundle.outputFiles[0]!.text);
        for (const label of ['Name', 'Profile']) {
            const display = label === 'Name' ? document.querySelector('span')! : document.querySelector('button')!;
            display.getBoundingClientRect = () => ({ width: 144.5, height: 28.25 }) as DOMRect;
            window.flush(() => display.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
            const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
            assert.equal(input.style.width, '144.5px');
            assert.equal(input.style.height, '28.25px');
            assert.equal(input.style.boxSizing, 'border-box');
            assert.equal(input.style.minWidth, input.style.maxWidth);
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, label === 'Name' ? 'invalid' : 'Renamed');
            window.flush(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
            window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
            if (label === 'Name') {
                assert.equal(document.querySelector('input'), input);
                window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
            }
            assert.equal(document.querySelector('input'), null);
        }
        assert.deepEqual(Array.from(window.commits), ['invalid', 'Renamed']);
    } finally { window.close(); }
});
