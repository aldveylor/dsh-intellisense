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
            import { EditableText, InlineEditorContext } from './src/management/controls/editable_text.js';
            function NativeEditor({ value, label, onChange, className }) {
                return <textarea className={className} data-native-renderer aria-label={label} value={value}
                    onChange={event => onChange(event.target.value)} />;
            }
            window.flush = flushSync;
            window.commits = [];
            flushSync(() => createRoot(document.getElementById('root')).render(<>
                <EditableText value='Name' label='Name' commit={value => {
                    window.commits.push(value); return value !== 'invalid';
                }} />
                <EditableText value='Profile' label='Profile' commit={value => window.commits.push(value)}
                    renderDisplay={beginEdit => <button onDoubleClick={event => beginEdit(event.currentTarget)}>Profile</button>} />
                <InlineEditorContext.Provider value={NativeEditor}>
                    <EditableText value='Native' label='Native' commit={value => window.commits.push(value)} />
                </InlineEditorContext.Provider>
            </>));
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    });
    const dom = new JSDOM('<style>textarea{margin:3px 5px;padding:6px 8px;border:1px solid}</style><div id="root" style="overflow:hidden;height:20px"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    const document = window.document;
    let containerWidth = 400;
    document.getElementById('root')!.getBoundingClientRect = () => ({ left: 10, width: containerWidth }) as DOMRect;
    const shown = new Set<HTMLElement>();
    window.HTMLElement.prototype.showPopover = function () {
        shown.add(this);
        const overlay = document.querySelector<HTMLElement>('.ts-inline-editor-overlay')!;
        overlay.getBoundingClientRect = () => ({ left: parseFloat(overlay.style.left) || 0, top: parseFloat(overlay.style.top) || 0 }) as DOMRect;
        const editor = overlay.querySelector('textarea')!;
        editor.getBoundingClientRect = () => ({ left: overlay.getBoundingClientRect().left + 5, top: overlay.getBoundingClientRect().top + 3 }) as DOMRect;
    };
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
            let sourceHeight = 18;
            display.getBoundingClientRect = () => ({ left: 20, top, width: 144.5, height: sourceHeight }) as DOMRect;
            window.flush(() => display.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
            const input = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
            const sized = input.closest<HTMLElement>('.ts-inline-editor-overlay')!;
            assert.equal(display.isConnected, true, 'Display anchor must keep occupying its original layout');
            assert.equal(label === 'Profile' ? document.querySelector('button') : document.querySelector(`[aria-label="${label}"]`), display);
            assert(shown.has(sized), 'Editor must enter the browser top layer to escape overflow clipping');
            assert.equal(sized.getAttribute('popover'), 'manual');
            if (label === 'Native') {
                assert(input.closest('[data-native-renderer]'), 'Host InlineEditor must render the editor');
                assert.equal(input.tagName, 'TEXTAREA');
            }
            assert.equal(sized.style.position, 'fixed');
            assert.equal(sized.style.width, '428px');
            assert.equal(sized.style.height, '38px', 'Input can extend beyond the 18px source block');
            assert.equal(sized.style.left, '6px', 'Text start must compensate 5px margin, 1px border and 8px padding');
            assert.equal(sized.style.top, '30px', 'Text start must compensate 3px margin, 1px border and 6px padding');
            assert.equal(sized.style.fontFamily, 'monospace');
            assert.equal(sized.style.fontSize, '12px');
            assert.equal(sized.style.fontWeight, '600');
            assert.equal(sized.style.lineHeight, '18px');
            assert.equal(sized.style.letterSpacing, '0.5px');
            top = 70;
            window.dispatchEvent(new window.Event('scroll'));
            assert.equal(sized.style.top, '60px');
            const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
            Object.defineProperty(input, 'scrollHeight', { get: () => input.value.length > 100 ? 126 : 16 });
            setValue.call(input, 'Long wrapped content '.repeat(20));
            window.flush(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
            assert.equal(sized.style.width, '428px', 'Content width plus both-side offsets must not grow with text');
            assert.equal(sized.style.height, '134px', 'Wrapped content must grow the editor height');
            containerWidth = 320;
            window.dispatchEvent(new window.Event('resize'));
            assert.equal(sized.style.width, '348px', 'Width must follow the parent container');
            containerWidth = 400;
            setValue.call(input, label === 'Name' ? 'invalid' : 'Renamed');
            window.flush(() => input.dispatchEvent(new window.Event('input', { bubbles: true })));
            assert.equal(sized.style.height, '38px', 'Shortening text must restore the minimum height');
            sourceHeight = 96;
            window.dispatchEvent(new window.Event('resize'));
            assert.equal(sized.style.height, '116px', 'Original multiline display height must remain the minimum');
            input.style.paddingRight = '12px';
            input.style.paddingBottom = '10px';
            input.style.marginRight = '7px';
            input.style.marginBottom = '5px';
            window.dispatchEvent(new window.Event('resize'));
            assert.equal(sized.style.width, '434px', 'Asymmetric offsets must be added individually');
            assert.equal(sized.style.height, '122px', 'Original content height must include both vertical offsets');
            window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
            assert.equal(input.isConnected, true, 'Shift+Enter must leave the multiline editor open');
            window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
            assert.equal(input.isConnected, true, 'IME Escape must not cancel the draft');
            window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
            if (label === 'Name') {
                assert.equal(document.querySelector('textarea'), input);
                window.flush(() => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
            }
            assert.equal(document.querySelector('textarea'), null);
            assert.equal(shown.size, 0, 'Closing an editor must release the top layer');
        }
        assert.deepEqual(Array.from(window.commits), ['invalid', 'Renamed', 'Renamed']);
    } finally { window.close(); }
});
