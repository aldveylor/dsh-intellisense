import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

/** @brief Wait for a standalone icon render to commit. */
async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await delay(10);
    assert(predicate());
}

test('icon state and animation validity work independently of surrounding buttons', async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { ChevronIcon, DisableIcon, PinIcon } from './src/management/controls/icons.js';
            import { FilterIcon, FilterCheckIcon } from './src/management/tool_picker/tool_filter/filter_icons.js';
            import { SortDirectionIcon } from './src/management/tool_picker/sort_direction_icon.js';
            import { ViewMenuIcon } from './src/management/tool_picker/tool_layout/animated_icons.js';
            const root = createRoot(document.getElementById('root'));
            window.renderIcons = (active, valid) => root.render(<>
                <ChevronIcon valid={valid} open={active} />
                <DisableIcon valid={valid} disabled={active} />
                <PinIcon valid={valid} active={active} level={active ? 2 : 0} />
                <FilterIcon valid={valid} open={active} active={active} />
                <FilterCheckIcon valid={valid} checked={active} />
                <SortDirectionIcon valid={valid} descending={active} />
                <ViewMenuIcon valid={valid} open={false} value={active ? 'list' : 'cards'} />
            </>);
            window.unmountIcons = () => root.unmount();
            window.renderIcons(false, true);
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, write: false,
    });
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
    try {
        const { window } = dom;
        const document = window.document;
        const browser = window as unknown as { renderIcons: (active: boolean, valid: boolean) => void; unmountIcons: () => void };
        /** @brief Inspect computed icon presentation without button or panel CSS. */
        const style = (selector: string) => window.getComputedStyle(document.querySelector(selector)!);
        window.eval(result.outputFiles[0]!.text);
        await until(() => !!document.querySelector('.ts-pin-icon'));
        assert.equal(document.querySelector('#root')!.textContent, '', 'Icon styles must not become button text');
        assert.equal(style('.ts-tool-filter-check path').opacity, '0');
        assert.equal(style('.ts-pin-icon').fill, 'rgba(0, 0, 0, 0)');
        browser.renderIcons(true, true);
        await until(() => document.querySelector('.ts-chevron-icon')?.getAttribute('data-open') === 'true');
        assert.equal(style('.ts-chevron-icon').transform, 'rotate(180deg)');
        assert.equal(style('.ts-disable-mark').transform, 'rotate(45deg)');
        assert.equal(style('.ts-sort-arrow').transform, 'rotate(180deg)');
        assert.equal(style('.ts-filter-dot').opacity, '1');
        assert.equal(style('.ts-tool-filter-check path').opacity, '1');
        // Supply a concrete theme color because jsdom cannot resolve light-dark token fallbacks.
        (document.querySelector('.ts-pin-icon') as unknown as SVGElement).style.color = 'rgb(155, 101, 0)';
        assert.equal(style('.ts-pin-icon').fill, 'rgb(155, 101, 0)');
        assert.equal(style('.ts-view-cell-1').width, '12px');
        browser.renderIcons(true, false);
        await until(() => document.querySelector('.ts-chevron-icon')?.getAttribute('data-valid') === 'false');
        assert.equal(style('.ts-chevron-icon').transition, 'none');
        assert.equal(style('.ts-disable-mark').transition, 'none');
        assert.equal(style('.ts-chevron-icon').transform, 'rotate(180deg)', 'Invalid animation retains the visible state');
        assert.equal(style('.ts-tool-filter-check path').opacity, '1');
        browser.unmountIcons();
        assert.equal(document.head.querySelectorAll('style').length, 0, 'Unused icon styles must be released');
    } finally { dom.window.close(); }
});
