import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/** @brief Verify top-layer editing preserves anchors, follows scrolling and respects commit/cancel semantics. */
test('inline editors retain their anchors and use a top-layer editor that follows scrolling', async () => {
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { forwardRef } from 'react';
            import { EditableText, InputContext } from './src/management/controls/editable_text.js';
            const NativeInput = forwardRef(function NativeInput({ className, ...props }, ref) {
                return <span className={className} data-native-renderer><input ref={ref} {...props} /></span>;
            });
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
    const dom = new JSDOM('<div id="root" style="overflow:hidden;height:20px"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    const document = window.document;
    const shown = new Set<HTMLElement>();
    window.HTMLElement.prototype.showPopover = function () { shown.add(this); };
    window.HTMLElement.prototype.hidePopover = function () { shown.delete(this); };
    try {
        window.eval(bundle.outputFiles[0]!.text);
        for (const label of ['Name', 'Profile', 'Native']) {
            const display = label === 'Profile' ? document.querySelector('button')! : document.querySelector(`[aria-label="${label}"]`)!;
            Object.assign((display as HTMLElement).style, {
                fontFamily: 'monospace', fontSize: '12px', fontWeight: '600', lineHeight: '18px',
                letterSpacing: '0.5px', padding: '0px', border: '0px solid',
            });
            let top = 40;
            display.getBoundingClientRect = () => ({ left: 20, top, width: 144.5, height: 18 }) as DOMRect;
            window.flush(() => display.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
            const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
            const sized = input.closest<HTMLElement>('.ts-inline-editor-overlay')!;
            assert.equal(display.isConnected, true, 'Display anchor must keep occupying its original layout');
            assert.equal(label === 'Profile' ? document.querySelector('button') : document.querySelector(`[aria-label="${label}"]`), display);
            assert(shown.has(sized), 'Editor must enter the browser top layer to escape overflow clipping');
            assert.equal(sized.getAttribute('popover'), 'manual');
            if (label === 'Native') {
                assert(input.closest('[data-native-renderer]'), 'Host Input must render the editor');
                assert.equal(input.dataset.dshControl, 'input');
            }
            assert.equal(sized.style.position, 'fixed');
            assert.equal(sized.style.width, '144.5px');
            assert.equal(sized.style.height, '32px', 'Input can extend beyond the 18px source block');
            assert.equal(sized.style.left, '20px');
            assert.equal(sized.style.top, '33px');
            assert.equal(sized.style.fontFamily, 'monospace');
            assert.equal(sized.style.fontSize, '12px');
            assert.equal(sized.style.fontWeight, '600');
            assert.equal(sized.style.lineHeight, '18px');
            assert.equal(sized.style.letterSpacing, '0.5px');
            top = 70;
            window.dispatchEvent(new window.Event('scroll'));
            assert.equal(sized.style.top, '63px');
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, label === 'Name' ? 'invalid' : 'Renamed');
            window.flush(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
            window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
            if (label === 'Name') {
                assert.equal(document.querySelector('input'), input);
                window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
            }
            assert.equal(document.querySelector('input'), null);
            assert.equal(shown.size, 0, 'Closing an editor must release the top layer');
        }
        assert.deepEqual(Array.from(window.commits), ['invalid', 'Renamed', 'Renamed']);
    } finally { window.close(); }
});
