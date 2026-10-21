import { useEffect, useState } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';

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

/** @brief Draggable tool block with an inspectable mapping and native schemas. */
function ToolBlock({ tool, mapping, busy, mount, update, remove }: {
    tool: PhysicalTool; mapping?: Mapping; busy: boolean; mount: () => void;
    update: (patch: Partial<Mapping>) => void; remove: () => void;
}) {
    return <section className={`ts-tool ${mapping?.path.trim() ? '' : 'ts-unmounted'}`}
        draggable={!busy && !mapping?.pinned} onDragStart={event => {
            event.dataTransfer.setData('application/x-ts-tool', tool.id);
            event.dataTransfer.effectAllowed = 'copyMove';
        }}>
        <div className="ts-actions"><strong>{tool.id}</strong><small>{mapping?.path.trim() ? '已挂载' : '未挂载'}</small>
            <button disabled={busy || mapping?.pinned} onClick={mount}>挂载</button></div>
        <p>{tool.description}</p><code>{mapping?.path || 'unknown · 拖到上方命名空间挂载'}</code>
        <details><summary>映射配置与类型</summary>
            <label>语义路径<input aria-label={`语义路径 ${tool.id}`} value={mapping?.path ?? ''} disabled={busy || mapping?.pinned}
                onChange={e => update({ path: e.target.value })} /></label>
            <label>别名<input aria-label={`别名 ${tool.id}`} value={mapping?.aliases.join(',') ?? ''} disabled={busy || mapping?.pinned}
                placeholder="以逗号分隔" onChange={e => update({ aliases: e.target.value.split(',') })} /></label>
            <label>备注<input aria-label={`映射备注 ${tool.id}`} value={mapping?.description ?? ''} disabled={busy}
                onChange={e => update({ description: e.target.value })} /></label>
            <div className="ts-actions"><label><input type="checkbox" aria-label={`启用 ${tool.id}`} checked={mapping?.enabled ?? true} disabled={busy}
                onChange={e => update({ enabled: e.target.checked })} />启用</label>
                <label><input type="checkbox" aria-label={`固定 ${tool.id}`} checked={mapping?.pinned ?? false} disabled={busy}
                    onChange={e => update({ pinned: e.target.checked })} />固定</label>
                <button disabled={busy || !mapping || mapping.pinned} onClick={remove}>取消挂载</button></div>
            <h4>参数</h4><pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
            <h4>返回值</h4><pre>{JSON.stringify(tool.output, null, 2)}</pre>
        </details>
    </section>;
}

/** @brief Recursive expandable namespace node with editable metadata and drop targets. */
function NamespaceNode({ path, paths, mappings, namespaces, busy, configure, drop }: {
    path: string; paths: string[]; mappings: Mapping[]; namespaces: Namespace[]; busy: boolean;
    configure: (path: string, patch: Partial<Namespace>) => void; drop: (id: string, path: string) => void;
}) {
    const [over, setOver] = useState(false);
    const config = namespaces.find(n => n.path === path);
    const children = paths.filter(p => p.startsWith(`${path}.`) && p.split('.').length === path.split('.').length + 1);
    const mounted = mappings.flatMap(m => [m.path, ...m.aliases].map(p => ({ path: p, id: m.id })))
        .filter(m => m.path.slice(0, m.path.lastIndexOf('.')) === path);
    return <li><details open><summary className={over ? 'ts-drop-over' : ''}
        onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/x-ts-tool')) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={event => {
            event.preventDefault(); setOver(false);
            if (!busy) drop(event.dataTransfer.getData('application/x-ts-tool'), path);
        }}><span className="ts-node-name">{path.split('.').at(-1)}</span>
        <span className="ts-node-config" onClick={event => event.stopPropagation()}>
            <label><input type="checkbox" aria-label={`一直显示 ${path}`} checked={config?.alwaysVisible ?? false} disabled={busy}
                onChange={event => configure(path, { alwaysVisible: event.target.checked })} />一直显示</label>
            <input aria-label={`命名空间注释 ${path}`} placeholder="命名空间注释" value={config?.description ?? ''} disabled={busy}
                onChange={event => configure(path, { description: event.target.value })} />
        </span></summary><ul>
        {children.map(child => <NamespaceNode key={child} path={child} paths={paths} mappings={mappings} namespaces={namespaces}
            busy={busy} configure={configure} drop={drop} />)}
        {mounted.map(m => <li className="ts-tree-tool" key={`${m.id}:${m.path}`}><code>{m.path.split('.').at(-1)}</code><small>{m.id}</small></li>)}
        {!children.length && !mounted.length && <li className="ts-empty">将工具积木拖到此节点</li>}
        </ul></details></li>;
}

/** @brief React registry editor with versioned drafts, schema inspection and explicit proposal approval. */
export function ManagementPanel({ api }: ManagementPanelProps) {
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [namespaces, setNamespaces] = useState<Namespace[]>([]);
    const [newNamespace, setNewNamespace] = useState('');
    const [mount, setMount] = useState<{ id: string; namespace: string; name: string; alias: boolean }>();
    const [sessionId, setSessionId] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('正在加载…');
    const [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState<{ id: string; proposal: unknown }>();

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal): Promise<void> {
        const snapshot = await request<View>(api, undefined, signal);
        setView(snapshot); setMappings(structuredClone(snapshot.state.mappings));
        setNamespaces(structuredClone(snapshot.state.namespaces ?? []));
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
    const paths = [...new Set([
        ...namespaces.map(n => n.path),
        ...mappings.flatMap(m => [m.path, ...m.aliases].map(path => path.split('.').slice(0, -1).join('.'))),
    ].flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))).filter(Boolean))].sort();
    const unknown = view?.tools.filter(tool => !mappings.some(m => m.id === tool.id && m.path.trim())).length ?? 0;

    /** @brief Keep inferred and explicitly created namespaces in the same draft metadata model. */
    function configureNamespace(path: string, patch: Partial<Namespace>): void {
        setNamespaces(current => {
            const next = { path, alwaysVisible: false, description: '', ...current.find(n => n.path === path), ...patch };
            return [...current.filter(n => n.path !== path), next];
        });
    }

    /** @brief Open the same naming flow for drops and keyboard-accessible mount buttons. */
    function beginMount(id: string, namespace: string): void {
        const tool = view?.tools.find(t => t.id === id);
        const mapping = mappings.find(m => m.id === id);
        if (!tool || busy || mapping?.pinned) return;
        setMount({ id, namespace, name: mapping?.path.split('.').at(-1) ?? tool.id.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(?=\d)/, '_'), alias: false });
    }

    return <div className="ts-intellisense">
        <style>{styles}</style>
        <header><h1>TypeScript 工具注册表</h1><small>物理工具 · 语义命名空间 · DSH 原生策略</small></header>
        <p role="status" aria-live="polite">{status}</p>
        <div className="ts-actions">
            <button disabled={busy} onClick={() => void action('正在刷新…', reload)}>刷新</button>
            <button disabled={busy || !view} onClick={() => void action('正在保存…', async () => {
                await request(api, { action: 'configure', revision: view!.state.revision, namespaces, mappings: mappings.map(m => ({ ...m, path: m.path.trim(), aliases: m.aliases.map(alias => alias.trim()).filter(Boolean) })) });
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
        <main><section className="ts-namespaces"><h2>命名空间树</h2>
            <div className="ts-actions"><input aria-label="新建命名空间" placeholder="命名空间路径，如 workspace.files" value={newNamespace}
                disabled={busy} onChange={event => setNewNamespace(event.target.value)} />
                <button disabled={busy || !view || !newNamespace.trim()} onClick={() => {
                    const path = newNamespace.trim();
                    if (!/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(path)) { setStatus('请输入有效的命名空间路径。'); return; }
                    configureNamespace(path, {}); setNewNamespace('');
                }}>添加命名空间</button><small>拖动下方积木到树节点，选择挂载方式和名称；修改后保存配置。</small></div>
            <ul className="ts-tree">{paths.filter(path => !path.includes('.')).map(path => <NamespaceNode key={path} path={path}
                paths={paths} mappings={mappings} namespaces={namespaces} busy={busy} configure={configureNamespace} drop={beginMount} />)}</ul>
            {!paths.length && <p className="ts-empty">先添加命名空间，再拖入工具积木。</p>}
            <small>unknown：{unknown} 个未挂载工具 · 执行权限由 DSH 原生策略判断。</small>
        </section><section className="ts-toolbox"><h2>工具积木 <small>{tools.length} 个工具 · 红色表示未挂载</small></h2>
            <div className="ts-blocks">{tools.map(tool => <ToolBlock key={tool.id} tool={tool} mapping={mappings.find(m => m.id === tool.id)} busy={busy}
                mount={() => beginMount(tool.id, paths[0] ?? '')} update={patch => update(tool, patch)}
                remove={() => setMappings(current => current.filter(m => m.id !== tool.id))} />)}</div>
            {view && !tools.length && <p>{filter ? '没有匹配的工具。' : '当前没有可用工具。'}</p>}
        </section></main>
        {mount && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-mount-title">
            <form onSubmit={event => {
                event.preventDefault();
                const tool = view?.tools.find(t => t.id === mount.id);
                if (!tool) return;
                const path = `${mount.namespace}.${mount.name.trim()}`;
                const existing = mappings.find(m => m.id === tool.id);
                const occupied = [...mappings.flatMap(m => [m.path, ...m.aliases]), ...namespaces.map(n => n.path)];
                if (!/^[a-zA-Z_$][\w$]*$/.test(mount.name.trim()) || occupied.some(p => p === path || p.startsWith(`${path}.`)) ||
                    mappings.flatMap(m => [m.path, ...m.aliases]).some(p => path.startsWith(`${p}.`))) {
                    setStatus('挂载名称无效或与现有路径冲突。'); return;
                }
                update(tool, mount.alias && existing ? { aliases: [...existing.aliases, path] } : { path });
                setMount(undefined); setStatus('已更新挂载草稿，请保存配置。');
            }}>
                <h2 id="ts-mount-title">挂载工具 {mount.id}</h2>
                <label>命名空间<select aria-label="挂载命名空间" required value={mount.namespace} disabled={busy}
                    onChange={event => setMount({ ...mount, namespace: event.target.value })}>
                    <option value="" disabled>选择命名空间</option>{paths.map(path => <option key={path}>{path}</option>)}
                </select></label>
                <label>工具名称<input aria-label="挂载名称" required autoFocus value={mount.name} disabled={busy}
                    onChange={event => setMount({ ...mount, name: event.target.value })} /></label>
                <label>挂载方式<select aria-label="挂载方式" value={mount.alias ? 'alias' : 'move'} disabled={busy}
                    onChange={event => setMount({ ...mount, alias: event.target.value === 'alias' })}>
                    <option value="move">设为主路径</option><option value="alias" disabled={!mappings.some(m => m.id === mount.id && m.path)}>添加别名挂载</option>
                </select></label><p><code>{mount.namespace}.{mount.name}</code></p>
                <div className="ts-actions"><button disabled={busy || !mount.namespace} type="submit">确认挂载</button>
                    <button type="button" disabled={busy} onClick={() => setMount(undefined)}>取消</button></div>
            </form>
        </section></div>}
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
.ts-intellisense main{display:flex;flex-direction:column;gap:24px;margin-top:24px}.ts-namespaces,.ts-toolbox{background:var(--bg-secondary,#18202c);border:1px solid var(--border-color,#303d50);border-radius:10px;padding:20px;min-width:0}
.ts-intellisense pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.ts-intellisense input[type=checkbox]{width:16px;height:16px;vertical-align:middle}
.ts-tree,.ts-tree ul{list-style:none;padding-left:24px}.ts-tree{padding-left:0;max-height:440px;overflow:auto}.ts-tree summary{padding:8px;border-radius:6px;cursor:pointer;border:1px solid transparent}.ts-tree summary:hover{background:var(--bg-hover,#25384b)}.ts-tree summary.ts-drop-over{background:#245340;border:1px dashed #74ddb0}
.ts-node-name{display:inline-block;min-width:180px;font-family:monospace;font-weight:600}.ts-node-config{display:inline-flex;align-items:center;gap:20px;margin-left:20px}.ts-node-config input:not([type=checkbox]){width:320px}.ts-tree-tool{display:flex;gap:20px;align-items:center;padding:8px 24px;color:#84cfba}.ts-empty{color:var(--text-secondary,#a5b4c6);padding:12px}
.ts-blocks{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px;padding:12px 0}.ts-tool{position:relative;border:1px solid #418d78;border-left:6px solid #56ba9d;border-radius:8px;background:var(--bg-primary,#142c2a);padding:18px;min-width:0;overflow-wrap:anywhere;transition:box-shadow .15s,transform .15s}.ts-tool:before{content:'';position:absolute;top:-9px;left:26px;width:40px;height:9px;border:1px solid #418d78;border-bottom:0;border-radius:6px 6px 0 0;background:inherit}.ts-tool[draggable=true]{cursor:grab}.ts-tool[draggable=true]:hover{transform:translateY(-2px);box-shadow:0 5px 14px #0003}.ts-tool[draggable=true]:active{cursor:grabbing}.ts-tool.ts-unmounted{border-color:#e47777;border-left-color:#ed7070;background:var(--bg-primary,#351e27)}.ts-tool.ts-unmounted:before{border-color:#e47777}.ts-tool.ts-unmounted>.ts-actions small{color:#ed8b8b}.ts-tool>.ts-actions button{margin-left:auto}.ts-tool p{line-height:1.6}.ts-tool details{cursor:auto}.ts-tool label,.ts-backdrop form>label{display:block;margin:12px 0}.ts-tool label>input:not([type=checkbox]),.ts-backdrop form>label>input,.ts-backdrop form>label>select{display:block;width:100%;margin-top:6px}
.ts-intellisense [role=status]{white-space:pre-wrap;margin:16px 0;color:var(--text-secondary,#a8d4f2)}.ts-intellisense small{color:var(--text-secondary,#a5b4c6)}.ts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ts-intellisense details{margin:10px 0}
.ts-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.ts-backdrop section{background:var(--bg-primary,#18202c);border:1px solid var(--border-color,#425069);border-radius:10px;padding:24px;width:min(1000px,85vw);max-height:85vh;overflow:auto}
`;
