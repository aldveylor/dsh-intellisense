import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/** @brief Wait for React to commit an operation or animation event. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await delay(10);
    assert(predicate());
}

test('SVG actions wait for operation settlement and a full master cycle, including failed requests', async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { ProfilePicker } from './src/management/profile_picker/profile_picker.js';
            window.calls = 0;
            const operation = () => {
                window.calls++;
                return new Promise((resolve, reject) => { window.complete = resolve; window.fail = reject; }).catch(() => {});
            };
            createRoot(document.getElementById('root')).render(<ProfilePicker name="Default" profiles={['Default']} dirty={false} busy={false}
                refreshDisabled={false} select={() => {}} create={() => {}} rename={() => {}} remove={() => {}}
                refresh={operation} save={operation} download={operation} upload={operation} />);
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
    });
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/', runScripts: 'outside-only' });
    Object.defineProperty(dom.window, 'AnimationEvent', { value: dom.window.Event });
    const browser = dom.window as unknown as { calls: number; complete: () => void; fail: (error: Error) => void };
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        await until(() => !!dom.window.document.querySelector('[data-action=refresh]'));
        const refresh = dom.window.document.querySelector<SVGSVGElement>('[data-action=refresh]')!;
        const button = refresh.closest('button')!;
        button.click();
        await until(() => refresh.dataset.running === 'true');
        button.click();
        assert.equal(browser.calls, 1, 'Repeated clicks must not duplicate an in-flight request');
        refresh.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await delay(20);
        assert.equal(refresh.dataset.running, 'true', 'Unfinished operations keep looping');
        browser.complete();
        await delay(20);
        assert.equal(refresh.dataset.running, 'true', 'Settlement waits for a cycle boundary');
        refresh.querySelector('path')!.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await delay(20);
        assert.equal(refresh.dataset.running, 'true', 'Child animations cannot end the master cycle');
        refresh.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => refresh.dataset.running === 'false');
        button.click();
        await until(() => browser.calls === 2 && refresh.dataset.running === 'true');
        browser.fail(new Error('Request failed'));
        await delay(20);
        assert.equal(refresh.dataset.running, 'true');
        refresh.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => refresh.dataset.running === 'false');
        const download = dom.window.document.querySelector<SVGSVGElement>('[data-action=download]')!;
        download.closest('button')!.click();
        await until(() => download.dataset.running === 'true');
        browser.complete();
        await delay(20);
        download.dispatchEvent(new dom.window.Event('animationiteration', { bubbles: true }));
        await until(() => download.dataset.running === 'false');
    } finally { dom.window.close(); }
});
