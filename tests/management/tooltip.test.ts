import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('tooltips require pointer rest before hover retention and retain Ctrl controls', async () => {
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
        advance(300);
        browser.run(() => browser.controls.move(50, 50, false));
        advance(300);
        leave();
        hover(true);
        advance(200);
        assert.equal(tooltip(), null, 'Moving restarts dwell; entering an unsettled tooltip cannot keep it open');

        show();
        advance(500);
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
        browser.run(() => browser.controls.move(80, 80, false));
        assert.equal(tooltip()!.textContent, 'second');
        assert.equal(tooltip()!.style.left, '96px', 'New tooltips resume following');
        leave();
        hover(true);
        advance(200);
        assert.equal(tooltip(), null, 'New tooltips require their own dwell');

        show();
        control(true);
        browser.run(() => browser.controls.move(80, 80, true));
        show('blocked');
        assert.equal(tooltip()!.textContent, 'first', 'Ctrl fixes content');
        assert.equal(tooltip()!.style.left, '36px', 'Ctrl fixes position');
        leave();
        hover(true);
        advance(1000);
        assert(tooltip(), 'Ctrl permits hovering without dwell');
        hover(false);
        advance(500);
        assert(tooltip(), 'Ctrl keeps details open outside both regions');
        control(false);
        advance(200);
        assert.equal(tooltip(), null, 'Releasing Ctrl resumes dismissal');

        show();
        browser.dispose();
        advance(0);
        assert.equal(timers.size, 0, 'Unmount clears pending pointer timers');
    } finally { dom.window.close(); }
});
