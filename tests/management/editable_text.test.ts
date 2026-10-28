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
            import { EditableText, InputContext } from './src/management/controls/editable_text.js';
            function NativeInput({ className, ...props }) {
                return <span className={className} data-native-renderer><input {...props} /></span>;
            }
            window.flush = flushSync;
            window.commits = [];
            flushSync(() => createRoot(document.getElementById('root')).render(<>
                <EditableText value='Name' label='Name' commit={value => {
                    window.commits.push(value); return value !== 'invalid';
                }} />
                <EditableText value='Profile' label='Profile' commit={value => window.commits.push(value)}
                    renderDisplay={beginEdit => <button onDoubleClick={event => beginEdit(event.currentTarget)}>Profile</button>} />
                <InputContext.Provider value={NativeInput}>
                    <EditableText value='Native' label='Native' commit={value => window.commits.push(value)} />
                </InputContext.Provider>
            </>));
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    });
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    const document = window.document;
    try {
        window.eval(bundle.outputFiles[0]!.text);
        for (const label of ['Name', 'Profile', 'Native']) {
            const display = label === 'Profile' ? document.querySelector('button')! : document.querySelector(`[aria-label="${label}"]`)!;
            Object.assign((display as HTMLElement).style, {
                fontFamily: 'monospace', fontSize: '12px', fontWeight: '600', lineHeight: '18px',
                letterSpacing: '0.5px', padding: '0px', border: '0px solid',
            });
            display.getBoundingClientRect = () => ({ width: 144.5, height: 28.25 }) as DOMRect;
            window.flush(() => display.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
            const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
            const sized = label === 'Native' ? input.closest<HTMLElement>('.ts-inline-editor')! : input;
            if (label === 'Native') {
                assert(input.closest('[data-native-renderer]'), 'Host Input must render the editor');
                assert.equal(input.dataset.dshControl, 'input');
            }
            assert.equal(sized.style.width, '144.5px');
            assert.equal(sized.style.height, '28.25px');
            assert.equal(sized.style.boxSizing, 'border-box');
            assert.equal(sized.style.minWidth, sized.style.maxWidth);
            assert.equal(sized.style.fontFamily, 'monospace');
            assert.equal(sized.style.fontSize, '12px');
            assert.equal(sized.style.fontWeight, '600');
            assert.equal(sized.style.lineHeight, '18px');
            assert.equal(sized.style.letterSpacing, '0.5px');
            assert.equal(sized.style.paddingTop, '0px');
            assert.equal(sized.style.borderTopWidth, '0px');
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
        assert.deepEqual(Array.from(window.commits), ['invalid', 'Renamed', 'Renamed']);
    } finally { window.close(); }
});
