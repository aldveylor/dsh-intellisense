import { useEffect, useState } from 'react';
import type { Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';

/** @brief Authenticated management metadata, shared by embedded and standalone React views. */
interface View {
    state: RegistryState;
    tools: PhysicalTool[];
    effective: Array<Mapping & { tool: PhysicalTool }>;
    declarations: string;
    sessions: Array<{ id: string }>;
}

/** @brief Shared editor inputs; the mounting surface supplies its authenticated API URL. */
export interface ManagementPanelProps { api: string }

/** @brief Make an authenticated same-origin request and preserve server error details. */
async function request<T>(api: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(api, {
        credentials: 'same-origin', signal,
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
}

/** @brief One editable mapping, with physical descriptions and schemas rendered safely as React text. */
function ToolRow({ tool, mapping, busy, update, remove }: {
    tool: PhysicalTool; mapping?: Mapping; busy: boolean;
    update: (patch: Partial<Mapping>) => void; remove: () => void;
}) {
    return <tr>
        <td><code>{tool.id}</code><details><summary>签名 / 参数 / 返回值</summary>
            <h4>参数</h4><pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
            <h4>返回值</h4><pre>{JSON.stringify(tool.output, null, 2)}</pre>
        </details></td>
        <td><input aria-label={`语义路径 ${tool.id}`} value={mapping?.path ?? ''} disabled={busy || mapping?.pinned}
            placeholder="未配置，使用 unknown 命名空间" onChange={e => update({ path: e.target.value })} />
            <input aria-label={`别名 ${tool.id}`} value={mapping?.aliases.join(',') ?? ''} disabled={busy || mapping?.pinned}
                placeholder="别名，以逗号分隔" onChange={e => update({ aliases: e.target.value.split(',') })} /></td>
        <td><p>{tool.description}</p><input aria-label={`映射备注 ${tool.id}`} value={mapping?.description ?? ''} disabled={busy}
            placeholder="映射备注（可选）" onChange={e => update({ description: e.target.value })} /></td>
        <td><input type="checkbox" aria-label={`启用 ${tool.id}`} checked={mapping?.enabled ?? true} disabled={busy}
            onChange={e => update({ enabled: e.target.checked })} /></td>
        <td><input type="checkbox" aria-label={`固定 ${tool.id}`} checked={mapping?.pinned ?? false} disabled={busy}
            onChange={e => update({ pinned: e.target.checked })} /></td>
        <td><button disabled={busy || !mapping || mapping.pinned} onClick={remove}>移至 unknown</button></td>
    </tr>;
}

/** @brief React registry editor with versioned drafts, schema inspection and explicit proposal approval. */
export function ManagementPanel({ api }: ManagementPanelProps) {
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [sessionId, setSessionId] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('正在加载…');
    const [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState<{ id: string; proposal: unknown }>();

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal): Promise<void> {
        const snapshot = await request<View>(api, undefined, signal);
        setView(snapshot); setMappings(structuredClone(snapshot.state.mappings));
        setSessionId(current => snapshot.sessions.some(s => s.id === current) ? current : snapshot.sessions[0]?.id ?? '');
        setStatus(`修订 ${snapshot.state.revision} · ${snapshot.tools.length} 个物理工具 · ${snapshot.state.mappings.length} 个已配置映射`);
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setStatus('正在加载…');
        void reload(controller.signal).catch(error => { if (!controller.signal.aborted) setStatus(String(error instanceof Error ? error.message : error)); });
        return () => controller.abort();
    }, [api]);

    /** @brief Report failed actions without losing unsaved mapping edits. */
    async function action(message: string, task: () => Promise<void>): Promise<void> {
        setBusy(true); setStatus(message);
        try { await task(); }
        catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    }

    /** @brief Create a draft mapping only when the user edits that tool. */
    function update(tool: PhysicalTool, patch: Partial<Mapping>): void {
        setMappings(current => {
            const existing = current.find(m => m.id === tool.id);
            const next: Mapping = { id: tool.id, path: '', aliases: [], enabled: true, pinned: false, ...existing, ...patch };
            return existing ? current.map(m => m.id === tool.id ? next : m) : [...current, next];
        });
    }

    const filter = search.trim().toLowerCase();
    const tools = view?.tools.filter(tool => {
        const mapping = mappings.find(m => m.id === tool.id);
        return `${tool.id} ${mapping?.path ?? ''} ${mapping?.aliases.join(' ') ?? ''} ${tool.description} ${mapping?.description ?? ''}`.toLowerCase().includes(filter);
    }) ?? [];
    const paths = mappings.flatMap(m => [m.path, ...m.aliases]).filter(Boolean).sort();
    const unknown = view?.tools.filter(tool => !mappings.some(m => m.id === tool.id)).length ?? 0;

    return <div className="ts-intellisense">
        <style>{styles}</style>
        <header><h1>TypeScript 工具注册表</h1><small>物理工具 · 语义命名空间 · DSH 原生策略</small></header>
        <p role="status" aria-live="polite">{status}</p>
        <div className="ts-actions">
            <button disabled={busy} onClick={() => void action('正在刷新…', reload)}>刷新</button>
            <button disabled={busy || !view} onClick={() => void action('正在保存…', async () => {
                await request(api, { action: 'configure', revision: view!.state.revision, mappings: mappings.map(m => ({ ...m, path: m.path.trim(), aliases: m.aliases.map(alias => alias.trim()).filter(Boolean) })) });
                await reload();
            })}>保存配置</button>
            <select aria-label="用于整理的会话" value={sessionId} disabled={busy} onChange={e => setSessionId(e.target.value)}>
                {!view?.sessions.length && <option value="">暂无 TypeScript 会话</option>}
                {view?.sessions.map(session => <option key={session.id} value={session.id}>{session.id}</option>)}
            </select>
            <button disabled={busy || !sessionId || !view} onClick={() => void action('维护子代理正在生成整理提案…', async () => {
                setProposal(await request(api, { action: 'organize', sessionId })); setStatus('整理提案已生成，请审核后应用。');
            })}>生成整理提案</button>
            <input type="search" aria-label="搜索工具" placeholder="搜索名称、路径或描述" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <main><aside><h2>命名空间</h2><pre>{paths.map(path => path.split('.').map((part, i) => `${'  '.repeat(i)}${part}`).join('\n')).join('\n\n') || '暂无已配置命名空间'}</pre>
            <p>unknown：{unknown} 个未配置工具</p><small>执行权限由 DSH 原生策略判断。</small></aside>
            <article><h2>工具与映射</h2><div className="ts-table"><table><thead><tr><th>物理身份 / 类型</th><th>语义路径 / 别名</th><th>描述 / 备注</th><th>启用</th><th>固定</th><th>操作</th></tr></thead>
                <tbody>{tools.map(tool => <ToolRow key={tool.id} tool={tool} mapping={mappings.find(m => m.id === tool.id)} busy={busy}
                    update={patch => update(tool, patch)} remove={() => setMappings(current => current.filter(m => m.id !== tool.id))} />)}</tbody>
            </table>{view && !tools.length && <p>{filter ? '没有匹配的工具。' : '当前没有可用工具。'}</p>}</div></article></main>
        {proposal && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-proposal-title">
            <h2 id="ts-proposal-title">整理提案</h2><pre>{JSON.stringify(proposal.proposal, null, 2)}</pre>
            <p>应用后更新命名映射；执行权限仍由 DSH 原生策略判断。</p>
            <div className="ts-actions"><button disabled={busy} onClick={() => void action('正在应用提案…', async () => {
                await request(api, { action: 'approve', id: proposal.id }); setProposal(undefined); await reload();
            })}>校验并应用</button><button disabled={busy} onClick={() => setProposal(undefined)}>取消</button></div>
        </section></div>}
    </div>;
}

const styles = `
.ts-intellisense{font:14px system-ui,sans-serif;color:var(--text-primary,#dce3ed);padding:24px;min-width:850px;box-sizing:border-box}
.ts-intellisense *{box-sizing:border-box}.ts-intellisense header{display:flex;align-items:center;gap:24px}.ts-intellisense h1{font-size:22px}.ts-intellisense h2{font-size:17px}.ts-intellisense h4{margin:12px 0 4px}
.ts-intellisense button,.ts-intellisense input,.ts-intellisense select{font:inherit;color:inherit;background:var(--bg-secondary,#1c2633);border:1px solid var(--border-color,#425069);border-radius:6px;padding:8px}
.ts-intellisense button{cursor:pointer}.ts-intellisense button:hover{background:var(--bg-hover,#304565)}.ts-intellisense :disabled{opacity:.5;cursor:default}
.ts-intellisense main{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px;margin-top:24px}.ts-intellisense aside,.ts-intellisense article{background:var(--bg-secondary,#18202c);border:1px solid var(--border-color,#303d50);border-radius:8px;padding:16px;min-width:0}
.ts-intellisense pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.ts-intellisense table{border-collapse:collapse;width:100%}.ts-intellisense td,.ts-intellisense th{padding:10px 8px;border-bottom:1px solid var(--border-color,#303d50);text-align:left;vertical-align:top}
.ts-intellisense td input:not([type=checkbox]){display:block;width:100%;min-width:150px;margin:4px 0}.ts-intellisense td p{margin:4px 0 10px}.ts-intellisense input[type=checkbox]{width:18px;height:18px}
.ts-intellisense [role=status]{white-space:pre-wrap;margin:16px 0;color:var(--text-secondary,#a8d4f2)}.ts-intellisense small{color:var(--text-secondary,#a5b4c6)}.ts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ts-table{overflow:auto}.ts-intellisense details{margin:10px 0}
.ts-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.ts-backdrop section{background:var(--bg-primary,#18202c);border:1px solid var(--border-color,#425069);border-radius:10px;padding:24px;width:min(1000px,85vw);max-height:85vh;overflow:auto}
`;
