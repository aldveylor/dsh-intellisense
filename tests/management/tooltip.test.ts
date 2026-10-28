import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('tooltips share the same fixed state for pointer rest and Ctrl', async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { TooltipProvider, useTooltip } from './src/management/tooltip/tooltip.js';
            function Controls() { window.controls = useTooltip(); return null; }
            const root = createRoot(document.getElementById('root'));
            window.run = callback => flushSync(callback);
            window.dispose = () => flushSync(() => root.unmount());
            flushSync(() => root.render(<TooltipProvider><Controls /></TooltipProvider>));
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    });
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
    const browser = dom.window as unknown as {
        controls: {
            show: (content: string, x: number, y: number) => void;
            move: (x: number, y: number, ctrlKey: boolean) => void;
            leave: () => void;
        };
        run: (callback: () => void) => void;
        dispose: () => void;
    };
    let now = 0;
    let timerId = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    dom.window.setTimeout = ((callback: () => void, delay = 0) => {
        timers.set(++timerId, { at: now + delay, callback });
        return timerId;
    }) as typeof dom.window.setTimeout;
    dom.window.clearTimeout = (id: number | undefined) => { timers.delete(id!); };
    dom.window.requestAnimationFrame = () => 1;
    dom.window.cancelAnimationFrame = () => {};

    /** @brief Advance pointer timers and commit any resulting React changes. */
    function advance(milliseconds: number): void {
        const end = now + milliseconds;
        while (true) {
            const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            timers.delete(next[0]);
            browser.run(next[1].callback);
        }
        now = end;
    }

    /** @brief Simulate entry or exit through React's pointer event delegation. */
    function hover(inside: boolean): void {
        const node = dom.window.document.querySelector('[role=tooltip]')!;
        browser.run(() => node.dispatchEvent(new dom.window.MouseEvent(inside ? 'pointerover' : 'pointerout', { bubbles: true })));
    }

    /** @brief Dispatch modifier changes through the provider's window listeners. */
    function control(held: boolean): void {
        browser.run(() => dom.window.dispatchEvent(new dom.window.KeyboardEvent(held ? 'keydown' : 'keyup', { key: 'Control' })));
    }

    const tooltip = () => dom.window.document.querySelector<HTMLElement>('[role=tooltip]');
    const show = (text = 'first') => browser.run(() => browser.controls.show(text, 20, 20));
    const leave = () => browser.run(() => browser.controls.leave());
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        show();
        assert.equal(tooltip()!.style.pointerEvents, 'none', 'Following tooltips must not intercept entry into underlying anchors');
        advance(300);
        browser.run(() => browser.controls.move(50, 50, false));
        advance(300);
        leave();
        hover(true);
        advance(200);
        assert.equal(tooltip(), null, 'Moving restarts dwell; entering an unsettled tooltip cannot keep it open');

        show();
        advance(500);
        assert.equal(tooltip()!.style.pointerEvents, 'auto', 'Settled tooltips accept pointer interaction');
        const left = tooltip()!.style.left;
        browser.run(() => browser.controls.move(100, 100, false));
        assert.equal(tooltip()!.style.left, left, 'Settled tooltips stop following the pointer');
        leave();
        advance(100);
        hover(true);
        advance(1000);
        assert(tooltip(), 'Settled tooltips allow crossing the gap and interacting');
        hover(false);
        advance(200);
        assert.equal(tooltip(), null);

        show();
        advance(500);
        show('second');
        assert.equal(tooltip()!.style.pointerEvents, 'none', 'Switching anchors disables hit testing until the new tooltip settles');
        browser.run(() => browser.controls.move(80, 80, false));
        assert.equal(tooltip()!.textContent, 'second');
        assert.equal(tooltip()!.style.left, '96px', 'New tooltips resume following');
        leave();
        hover(true);
        advance(200);
        assert.equal(tooltip(), null, 'New tooltips require their own dwell');

        show();
        control(true);
        assert.equal(tooltip()!.style.pointerEvents, 'auto', 'Ctrl immediately enables pointer interaction');
        browser.run(() => browser.controls.move(80, 80, true));
        assert.equal(tooltip()!.style.left, '36px', 'Ctrl fixes position');
        control(false);
        assert.equal(tooltip()!.style.pointerEvents, 'auto', 'Releasing Ctrl preserves the same fixed state as pointer rest');
        browser.run(() => browser.controls.move(120, 120, false));
        assert.equal(tooltip()!.style.left, '36px', 'The fixed tooltip stays in place after releasing Ctrl');
        leave();
        advance(100);
        hover(true);
        advance(1000);
        assert(tooltip(), 'Ctrl fixes the tooltip immediately and permits hovering after release');
        hover(false);
        advance(200);
        assert.equal(tooltip(), null, 'Ctrl-fixed tooltips dismiss on leaving just like dwell-fixed tooltips');

        show();
        control(true);
        show('second');
        assert.equal(tooltip()!.textContent, 'second', 'Switching anchors replaces a Ctrl-fixed tooltip just like a dwell-fixed tooltip');
        assert.equal(tooltip()!.style.pointerEvents, 'none', 'A new tooltip starts with its own rest timer');
        browser.run(() => browser.controls.move(80, 80, true));
        assert.equal(tooltip()!.style.pointerEvents, 'auto', 'Moving with Ctrl held fixes the new tooltip immediately');
        leave();
        advance(200);
        assert.equal(tooltip(), null, 'Holding Ctrl does not retain a tooltip outside both regions');
        control(false);

        const root = dom.window.document.getElementById('root')!;
        /** @brief Model host shortcuts that consume keyboard events before they reach window bubbling. */
        function consumeKey(event: Event): void { event.stopPropagation(); }
        root.addEventListener('keydown', consumeKey);
        root.addEventListener('keyup', consumeKey);
        show();
        browser.run(() => root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Control', bubbles: true })));
        leave();
        hover(true);
        advance(1000);
        assert(tooltip(), 'Ctrl must survive host keyboard handlers while entering the tooltip');
        hover(false);
        browser.run(() => root.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'Control', bubbles: true })));
        advance(200);
        assert.equal(tooltip(), null, 'Leaving a Ctrl-fixed tooltip dismisses even when keyup is consumed');

        show();
        leave();
        advance(100);
        browser.run(() => root.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, ctrlKey: true })));
        hover(true);
        browser.run(() => root.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, ctrlKey: false })));
        advance(1000);
        assert(tooltip(), 'Pointer modifiers recover a missed keydown; losing Ctrl does not undo fixation');
        hover(false);
        browser.run(() => root.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, ctrlKey: false })));
        advance(200);
        assert.equal(tooltip(), null, 'Leaving the fixed tooltip resumes normal dismissal');

        show();
        browser.dispose();
        advance(0);
        assert.equal(timers.size, 0, 'Unmount clears pending pointer timers');
    } finally { dom.window.close(); }
});
