import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { NamespaceComponent } from '../dist/profile/component.js';
import { SemanticRegistry } from '../dist/profile/catalog/registry.js';
import { MemoryStore } from '../dist/storage/store.js';
import { registerManagement } from '../dist/web/server/routes.js';
import { pluginCommands } from '../dist/runtime/builtins.js';

/** @brief Create a deterministic documentation profile without reading or modifying user data. */
async function documentationRegistry() {
    const registry = new SemanticRegistry(new MemoryStore());
    await registry.load();
    registry.refresh([
        { id: 'bash', source: 'Shell', description: 'Run a Bash command in the workspace.\nUse timeout to limit execution time. The result includes standard output, standard error and the exit code.',
            parameters: { type: 'object', additionalProperties: false, required: ['command'], properties: {
                command: { type: 'string', description: 'The Bash command to execute.' },
                timeout: { type: 'integer', description: 'Maximum execution time in milliseconds.' },
            } },
            output: { type: 'object', additionalProperties: false, required: ['stdout', 'stderr', 'exit_code'], properties: {
                stdout: { type: 'string', description: 'Standard output.' }, stderr: { type: 'string', description: 'Standard error.' }, exit_code: { type: 'integer', description: 'Process exit code.' },
            } } },
        ...[
            ['read_file', 'Read a UTF-8 file from the workspace.', 'path'],
            ['write_file', 'Write text to a workspace file.', 'path'],
            ['list_directory', 'List files and directories at a path.', 'path'],
            ['search_files', 'Find files containing the requested text.', 'query'],
            ['web_search', 'Search the web for information.', 'query'],
            ['fetch_url', 'Retrieve the content of a web page.', 'url'],
        ].map(([id, description, field]) => ({ id, description, source: 'Workspace',
            parameters: { type: 'object', additionalProperties: false, required: [field], properties: { [field]: { type: 'string' } } }, output: { type: 'string' } })),
        ...pluginCommands.builtinTools.map(command => ({ id: command.tool, description: command.description, source: 'dsh-intellisense', parameters: { type: 'object', additionalProperties: false }, output: {} })),
    ]);
    await registry.replaceConfiguration({
        mappings: [
            ['bash', 'std.shell.bash', 'Run shell commands.'],
            ['read_file', 'std.fs.read', 'Read a text file.'],
            ['write_file', 'std.fs.write', 'Write a text file.'],
            ['list_directory', 'std.fs.list', 'List directory entries.'],
        ].map(([id, path, description]) => ({ id, path, description, pinned: false, alwaysVisible: id === 'bash' ? 2 : 0 })),
        namespaces: [
            { path: 'std', description: 'Workspace tools', alwaysVisible: false },
            { path: 'std.shell', description: 'Shell execution', alwaysVisible: false },
            { path: 'std.fs', description: 'Files and directories', alwaysVisible: false },
        ],
        order: ['console', 'tools', 'std', 'std.shell', 'std.fs'], unmountedVisible: {}, builtinVisible: { 'tools.inspect': 2 }, namespaceVisible: {}, toolComments: {},
    }, 'Default');
    return registry;
}

const registry = await documentationRegistry();
const routes = new Map();
registerManagement({ connection: { fetch: { register: route => routes.set(route.path, route.fetch) } } }, new NamespaceComponent({ emit() {} }, registry), {
    catalog: registry, refresh: async () => {}, statistics: { snapshot: async () => ({ callsByTool: { bash: 128, read_file: 94, write_file: 31, list_directory: 46, search_files: 22, web_search: 12, fetch_url: 8 } }) },
});

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const handler = routes.get(url.pathname);
        if (!handler) { response.writeHead(404).end(); return; }
        const result = await handler(new Request(url));
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const language of ['en', 'zh']) {
        const context = await browser.newContext({ locale: language === 'zh' ? 'zh-CN' : 'en-US', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
        try {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error));
            await page.goto(`http://127.0.0.1:${server.address().port}/api/ts-intellisense`);
            await page.locator('[data-unmounted-count]').waitFor();
            await page.addStyleTag({ content: 'html{color-scheme:light}body{font-family:system-ui,"Microsoft YaHei",sans-serif}#root{max-width:1400px;margin:24px auto}' });
            for (const path of ['std', 'std.shell']) {
                await page.locator(`[data-namespace-path="${path}"] > .ts-disclosure`).click();
            }
            await page.locator('.ts-tree').evaluate(node => { node.scrollTop = 0; });
            await page.mouse.move(1400, 960);
            await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
            const directory = new URL(`../assets/${language}/`, import.meta.url);
            await mkdir(directory, { recursive: true });
            await page.screenshot({ path: fileURLToPath(new URL('namespace_table.png', directory)) });
            const toolbar = await page.locator('.ts-toolbar').boundingBox();
            const summary = await page.locator('.ts-profile-summary').boundingBox();
            await page.screenshot({ path: fileURLToPath(new URL('profile_editor.png', directory)), clip: {
                x: Math.max(0, toolbar.x - 12), y: Math.max(0, toolbar.y - 12), width: toolbar.width + 24,
                height: summary.y + summary.height - toolbar.y + 24,
            } });
            await page.locator('.ts-tree').screenshot({ path: fileURLToPath(new URL('namespace_tree.png', directory)) });

            // Exercise tree documentation and its nested physical-command details before capturing the picker.
            await page.locator('[data-namespace-path="std.shell"] .ts-node-name').hover();
            await page.locator('[role="tooltip"] .ts-tree-details').waitFor();
            assert((await page.locator('.ts-tree-details').innerText()).includes('std.shell'));
            await page.locator('[data-tree-path="std.shell.bash"] .ts-node-name').hover();
            await page.locator('.ts-command-details').waitFor();
            assert((await page.locator('.ts-command-details').innerText()).includes('128'));
            await page.keyboard.down('Control');
            await page.locator('.ts-original-command').hover();
            await page.keyboard.up('Control');
            await page.locator('.ts-tool-details:not(.ts-command-details)').waitFor();
            assert.equal(await page.locator('[role="tooltip"]').count(), 2);
            await page.keyboard.press('Escape');
            await page.mouse.move(1400, 960);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));

            await page.locator('.ts-open-tools').click();
            await page.locator('.ts-tool-picker[open]').waitFor();
            assert.equal(await page.locator('.ts-tool-picker .ts-builtin-tool:disabled').count(), pluginCommands.builtinTools.length);
            const colors = await page.locator('.ts-tool-picker').evaluate(node => {
                const style = getComputedStyle(node);
                return { background: style.backgroundColor, color: style.color };
            });
            assert.equal(colors.background, 'rgb(255, 255, 255)');
            assert.equal(colors.color, 'rgb(32, 33, 36)');
            assert.equal(await page.locator('.ts-tool-picker [data-tool-id="bash"]').evaluate(node => getComputedStyle(node, '::before').display), 'block');
            await page.mouse.move(1400, 960);
            await page.locator('.ts-tool-picker').screenshot({ path: fileURLToPath(new URL('tools.png', directory)) });
            await page.locator('.ts-tool-picker [data-tool-id="bash"]').hover();
            const details = page.locator('[role="tooltip"] .ts-tool-details');
            await details.waitFor();
            assert(!(await details.innerText()).includes('type Result ='));
            assert.equal(await details.locator('caption').count(), 0);
            await page.keyboard.down('Control');
            await details.locator('.ts-parameter-type').first().hover();
            await page.keyboard.up('Control');
            await page.locator('.ts-parameter-type-code').waitFor();
            assert.equal((await page.locator('.ts-parameter-type-code').innerText()).trim(), 'string');
            await page.keyboard.press('Escape');
            await page.locator('.ts-tool-picker [data-tool-id="bash"]').hover();
            await details.waitFor();
            await page.locator('[role="tooltip"]').screenshot({ path: fileURLToPath(new URL('tooltip.png', directory)) });
            await page.mouse.move(1400, 960);
            await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
            await page.emulateMedia({ colorScheme: 'dark' });
            // The page uses DSH theme variables when available, and inherited color-scheme otherwise.
            await page.addStyleTag({ content: 'html{color-scheme:dark}' });
            assert.equal(await page.locator('.ts-tool-picker').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 32, 32)');
            const hostTheme = await page.addStyleTag({ content: '.ts-intellisense{--dsw-alias-bg-layer-2:rgb(40,45,50);--dsw-alias-label-primary:rgb(230,235,240)}' });
            assert.equal(await page.locator('.ts-tool-picker').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(40, 45, 50)');
            assert.equal(await page.locator('.ts-tool-picker').evaluate(node => getComputedStyle(node).color), 'rgb(230, 235, 240)');
            await hostTheme.evaluate(node => node.remove());
            assert.deepEqual(errors, []);
            await rm(new URL('unmounted_tools.png', directory), { force: true });
            console.log(`Updated assets/${language}/{namespace_table,profile_editor,namespace_tree,tools,tooltip}.png`);
        } finally { await context.close(); }
    }
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
