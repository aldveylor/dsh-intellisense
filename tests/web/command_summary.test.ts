import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('method blocks fall back to original documentation while tooltips keep absent summaries empty', async () => {
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { NamespaceTree } from './src/web/panel/tree_node.js';
            import { FunctionNode } from './src/web/panel/tree_view/function_node.js';
            import { TooltipProvider } from './src/web/ui/tooltip/tooltip.js';
            import { TranslationContext, translate } from './src/web/locale/locale.js';
            const root = createRoot(document.getElementById('root'));
            const tool = { id: 'read', description: 'Complete default documentation.', parameters: {} };
            window.render = description => {
                const model = new NamespaceTree({mappings: [{id: 'read', path: 'read', description}], namespaces: [], order: []}, [], [tool]);
                const tree = {toolsById: new Map([['read', tool]]), toolComments: {}, callsByTool: {}, queriesByTool: {},
                    invalid: () => false, disabled: () => false, disabledByAncestor: () => false};
                flushSync(() => root.render(<TranslationContext.Provider value={translate('zh')}><TooltipProvider>
                    <ul><FunctionNode node={model.roots[0]} tree={tree} /></ul>
                </TooltipProvider></TranslationContext.Provider>));
                flushSync(() => document.querySelector('.ts-tool-preview').dispatchEvent(new FocusEvent('focusin', {bubbles: true})));
            };
            window.dispose = () => flushSync(() => root.unmount());
        ` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, loader: { '.css': 'text' },
    });
    const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
    Object.defineProperty(dom.window, 'structuredClone', { value: structuredClone });
    dom.window.requestAnimationFrame = () => 1;
    dom.window.cancelAnimationFrame = () => {};
    const browser = dom.window as unknown as { render: (summary?: string) => void; dispose: () => void };
    try {
        dom.window.eval(result.outputFiles[0]!.text);
        for (const summary of [undefined, '', ' \n ', 'Short summary.']) {
            browser.render(summary);
            assert.equal(dom.window.document.querySelector('.ts-tool-preview')!.textContent, summary?.trim() || 'Complete default documentation.');
            const sections = dom.window.document.querySelectorAll('.ts-command-details section');
            assert.equal(sections[1]!.querySelector('p')!.textContent, summary?.trim() || '无');
            assert.equal(sections[2]!.querySelector('p')!.textContent, 'Complete default documentation.');
        }
    } finally { browser.dispose(); dom.window.close(); }
});
