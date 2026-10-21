import type { Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';

/** @brief Management snapshot contains only metadata and explicit configuration. */
interface View { state: RegistryState; tools: PhysicalTool[]; effective: Array<Mapping & { tool: PhysicalTool }>; declarations: string; sessions: Array<{ id: string }> }
let view: View;
let mappings: Mapping[] = [];
let proposalId = '';
const api = './ts-intellisense-state';
/** @brief Resolve a required element with its expected DOM type. */
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
/** @brief Always render model/tool metadata as text, never HTML. */
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = value; return node;
}
/** @brief Authenticated same-origin API with explicit JSON bodies. */
async function request<T>(body?: unknown): Promise<T> {
    const response = await fetch(api, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
}
/** @brief Run a UI action and report actionable errors without losing draft edits. */
async function action(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch (error) { element('status').textContent = error instanceof Error ? error.message : String(error); }
}
/** @brief Reload a versioned snapshot; save requests use its revision for conflict detection. */
async function reload(): Promise<void> {
    view = await request<View>(); mappings = structuredClone(view.state.mappings);
    const sessions = element<HTMLSelectElement>('session'); sessions.replaceChildren();
    for (const s of view.sessions) { const option = text('option', s.id); option.value = s.id; sessions.append(option); }
    render(); element('status').textContent = `修订 ${view.state.revision} · ${view.tools.length} 个物理工具 · ${view.state.mappings.length} 个已配置映射`;
}
/** @brief Edit a text field without interpreting arbitrary metadata as markup. */
function field(value: string, update: (value: string) => void): HTMLInputElement {
    const input = document.createElement('input'); input.type = 'text'; input.value = value; input.addEventListener('input', () => update(input.value)); return input;
}
/** @brief Render a searchable tool list, namespace tree and physical schemas. */
function render(): void {
    const filter = element<HTMLInputElement>('search').value.toLowerCase();
    const rows = element('rows'); rows.replaceChildren();
    const paths = view.effective.map(m => m.path).sort();
    element('tree').textContent = paths.map(p => p.split('.').map((part, i) => `${'  '.repeat(i)}${part}`).join('\n')).join('\n\n');
    for (const item of view.effective) {
        if (filter && !`${item.id} ${item.path} ${item.tool.description}`.toLowerCase().includes(filter)) continue;
        let mapping = mappings.find(m => m.id === item.id);
        const ensure = (): Mapping => {
            if (!mapping) { mapping = { id: item.id, path: '', aliases: [], enabled: true, authorized: false, pinned: false }; mappings.push(mapping); }
            return mapping;
        };
        const row = document.createElement('tr');
        const identity = document.createElement('td'); identity.append(text('code', item.id));
        const details = document.createElement('details'); details.append(text('summary', '签名 / 参数 / 返回值'));
        details.append(text('pre', `(args: ${JSON.stringify(item.tool.parameters, null, 2)}) => Promise<${JSON.stringify(item.tool.output, null, 2)}>`)); identity.append(details); row.append(identity);
        const names = document.createElement('td');
        const path = field(mapping?.path ?? '', v => { ensure().path = v.trim(); }); path.placeholder = item.path; path.setAttribute('aria-label', `语义路径 ${item.id}`);
        const aliases = field(mapping?.aliases.join(', ') ?? '', v => { ensure().aliases = v.split(',').map(a => a.trim()).filter(Boolean); }); aliases.placeholder = '别名，以逗号分隔';
        names.append(path, aliases); row.append(names);
        const description = document.createElement('td'); description.append(field(mapping?.description ?? item.tool.description, v => { ensure().description = v; })); row.append(description);
        for (const key of ['enabled', 'authorized', 'pinned'] as const) {
            const cell = document.createElement('td'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = mapping?.[key] ?? (key === 'enabled'); input.setAttribute('aria-label', `${key} ${item.id}`);
            input.addEventListener('change', () => { ensure()[key] = input.checked; }); cell.append(input); row.append(cell);
        }
        const operations = document.createElement('td'); const reset = text('button', '移至 unknown');
        reset.disabled = !!mapping?.pinned; reset.addEventListener('click', () => { mappings = mappings.filter(m => m.id !== item.id); render(); }); operations.append(reset); row.append(operations);
        rows.append(row);
    }
}

element('reload').addEventListener('click', () => { void action(reload); });
element('search').addEventListener('input', render);
element('save').addEventListener('click', () => { void action(async () => { await request({ action: 'configure', revision: view.state.revision, mappings }); await reload(); }); });
element('organize').addEventListener('click', () => { void action(async () => {
    const sessionId = element<HTMLSelectElement>('session').value;
    if (!sessionId) throw new Error('先创建一个使用 TypeScript REPL 模型路由的会话');
    element('status').textContent = '维护子代理正在生成整理提案…';
    const result = await request<{ id: string; proposal: unknown }>({ action: 'organize', sessionId }); proposalId = result.id;
    element('proposal-text').textContent = JSON.stringify(result.proposal, null, 2); element<HTMLDialogElement>('proposal').showModal();
}); });
element('approve').addEventListener('click', () => { void action(async () => { await request({ action: 'approve', id: proposalId }); element<HTMLDialogElement>('proposal').close(); await reload(); }); });
element('close-proposal').addEventListener('click', () => element<HTMLDialogElement>('proposal').close());
void action(reload);
