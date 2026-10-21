import { useEffect, useState } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';

/** @brief Authenticated management metadata, shared by embedded and standalone React views. */
interface View {
    sessionId?: string;
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

/** @brief Compact physical tool block; dropping it creates or moves its mapping directly. */
function ToolBlock({ tool, mapping, busy }: { tool: PhysicalTool; mapping?: Mapping; busy: boolean }) {
    return <section title={[tool.description, mapping?.description].filter(Boolean).join('\n')}
        className={`ts-tool ${mapping?.path.trim() ? '' : 'ts-unmounted'}`} tabIndex={busy || mapping?.pinned ? -1 : 0} draggable={!busy && !mapping?.pinned}
        onDragStart={event => {
            event.dataTransfer.setData('application/x-ts-tool', tool.id);
            event.dataTransfer.effectAllowed = 'move';
        }}>
        <strong>{tool.id}</strong><code>{mapping?.path || '未挂载'}</code>
    </section>;
}

/** @brief Editable mapped name, always shown beside the original physical tool identity. */
function MappedTool({ mapping, path, description, busy, rename, remove }: {
    mapping: Mapping; path: string; description?: string; busy: boolean;
    rename: (path: string, name: string) => boolean; remove: (path: string) => void;
}) {
    const [name, setName] = useState<string>();

    /** @brief Begin renaming only mappings that can be moved. */
    function begin(): void {
        if (!busy && !mapping.pinned) setName(path.split('.').at(-1)!);
    }

    return <li className="ts-tree-tool" title={description} draggable={name === undefined && !busy && !mapping.pinned}
        onDragStart={event => {
            event.stopPropagation();
            event.dataTransfer.setData('application/x-ts-tool', mapping.id);
            event.dataTransfer.setData('application/x-ts-mapping', path);
            event.dataTransfer.effectAllowed = 'move';
        }}>
        {name === undefined ? <code role="button" tabIndex={busy || mapping.pinned ? -1 : 0}
            title="双击重命名" onDoubleClick={begin} onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); begin(); }
            }}>{path.split('.').at(-1)}</code> : <input autoFocus aria-label={`映射名称 ${path}`} value={name} disabled={busy}
                onChange={event => setName(event.target.value)} onBlur={() => {
                    const value = name.trim();
                    if (!value || rename(path, value)) setName(undefined);
                }} onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    if (event.key === 'Escape') { event.preventDefault(); setName(undefined); }
                }} />}
        <span aria-hidden="true">→</span><small>{mapping.id}</small>
        <button aria-label={`移除映射 ${path}`} title="移除映射" disabled={busy || mapping.pinned} onClick={() => remove(path)}>×</button>
    </li>;
}

/** @brief Name a child namespace inline; empty names and Escape discard the pending entry. */
function NamespacePlaceholder({ parent = '', busy, create, drop }: {
    parent?: string; busy: boolean; create: (path: string) => boolean;
    drop?: (id: string, path: string, source?: string) => void;
}) {
    const [name, setName] = useState<string>();
    const [over, setOver] = useState(false);

    /** @brief Start naming without changing the persisted namespace draft. */
    function begin(): void {
        if (!busy) setName('');
    }

    return <li className={`ts-empty ts-namespace-placeholder ${over ? 'ts-drop-over' : ''}`}
        onDragOver={event => {
            if (parent && !busy && event.dataTransfer.types.includes('application/x-ts-tool')) {
                event.preventDefault(); event.stopPropagation(); setOver(true);
            }
        }} onDragLeave={() => setOver(false)} onDrop={event => {
            if (!parent) return;
            event.preventDefault(); event.stopPropagation(); setOver(false);
            if (!busy) drop?.(event.dataTransfer.getData('application/x-ts-tool'), parent, event.dataTransfer.getData('application/x-ts-mapping'));
        }}>
        {name === undefined ? <span role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
            title="双击添加命名空间" onDoubleClick={begin} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(); }
            }}>{parent ? '将工具积木拖到此节点' : '双击添加根命名空间'}</span> : <input autoFocus aria-label={`命名新命名空间 ${parent || '根节点'}`}
            placeholder="命名空间名称" value={name} disabled={busy} onChange={event => setName(event.target.value)}
            onBlur={() => {
                const value = name.trim();
                if (!value || create(parent ? `${parent}.${value}` : value)) setName(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setName(undefined); }
            }} />}
    </li>;
}

/** @brief Recursive expandable namespace node with editable metadata and drop targets. */
function NamespaceNode({ path, paths, mappings, namespaces, busy, configure, drop, create, rename, remove, tools }: {
    path: string; paths: string[]; mappings: Mapping[]; namespaces: Namespace[]; busy: boolean;
    configure: (path: string, patch: Partial<Namespace>) => void; drop: (id: string, path: string, source?: string) => void;
    create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    remove: (path: string) => void; tools: PhysicalTool[];
}) {
    const [over, setOver] = useState(false);
    const config = namespaces.find(n => n.path === path);
    const children = paths.filter(p => p.startsWith(`${path}.`) && p.split('.').length === path.split('.').length + 1);
    const mounted = mappings.flatMap(m => [m.path, ...m.aliases].map(p => ({ path: p, mapping: m })))
        .filter(m => m.path.slice(0, m.path.lastIndexOf('.')) === path);
    return <li><details open><summary className={`ts-node-block ${over ? 'ts-drop-over' : ''}`}
        onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/x-ts-tool')) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={event => {
            event.preventDefault(); event.stopPropagation(); setOver(false);
            if (!busy) drop(event.dataTransfer.getData('application/x-ts-tool'), path, event.dataTransfer.getData('application/x-ts-mapping'));
        }}><span className="ts-node-header"><span className="ts-node-name">{path.split('.').at(-1)}</span>
            {config?.description && <span className="ts-node-preview" title={config.description}>{config.description}</span>}
            <label className="ts-node-visibility" onClick={event => event.stopPropagation()}>
                <input type="checkbox" aria-label={`一直显示 ${path}`} checked={config?.alwaysVisible ?? false} disabled={busy}
                    onChange={event => configure(path, { alwaysVisible: event.target.checked })} />一直显示
            </label>
        </span>
        <span className="ts-node-note" onClick={event => event.stopPropagation()}><span>
            <input aria-label={`命名空间注释 ${path}`} placeholder="命名空间注释" value={config?.description ?? ''} disabled={busy}
                onChange={event => configure(path, { description: event.target.value })} />
        </span></span></summary><ul>
        {children.map(child => <NamespaceNode key={child} path={child} paths={paths} mappings={mappings} namespaces={namespaces}
            busy={busy} configure={configure} drop={drop} create={create} rename={rename} remove={remove} tools={tools} />)}
        {mounted.map(m => <MappedTool key={`${m.mapping.id}:${m.path}`} mapping={m.mapping} path={m.path} busy={busy}
            description={tools.find(tool => tool.id === m.mapping.id)?.description} rename={rename} remove={remove} />)}
        <NamespacePlaceholder parent={path} busy={busy} create={create} drop={drop} />
        </ul></details></li>;
}

/** @brief React registry editor with versioned drafts, schema inspection and explicit proposal approval. */
export function ManagementPanel({ api }: ManagementPanelProps) {
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [namespaces, setNamespaces] = useState<Namespace[]>([]);
    const [sessionId, setSessionId] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('正在加载…');
    const [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState<{ id: string; proposal: unknown }>();

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal): Promise<void> {
        const url = new URL(api, document.baseURI);
        if (sessionId) url.searchParams.set('sessionId', sessionId);
        const snapshot = await request<View>(url.href, undefined, signal);
        setView(snapshot); setMappings(structuredClone(snapshot.state.mappings));
        setNamespaces(structuredClone(snapshot.state.namespaces ?? []));
        setStatus('');
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setMappings([]); setNamespaces([]); setProposal(undefined); setStatus('正在加载…');
        void reload(controller.signal).catch(error => { if (!controller.signal.aborted) setStatus(String(error instanceof Error ? error.message : error)); });
        return () => controller.abort();
    }, [api, sessionId]);

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

    /** @brief Commit only named namespaces that do not conflict with callable paths. */
    function createNamespace(path: string): boolean {
        const toolPaths = mappings.flatMap(m => [m.path, ...m.aliases]);
        if (!/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(path) || paths.includes(path) ||
            toolPaths.some(p => p === path || path.startsWith(`${p}.`))) {
            setStatus('命名空间名称无效或与现有路径冲突。'); return false;
        }
        configureNamespace(path, {});
        return true;
    }

    /** @brief Detect collisions across all callable mappings and namespace nodes. */
    function occupied(path: string, source?: string): boolean {
        return paths.includes(path) || mappings.flatMap(m => [m.path, ...m.aliases]).filter(p => p !== source)
            .some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`));
    }

    /** @brief Replace one mapped path while keeping the tool's physical identity intact. */
    function replacePath(source: string, path: string): void {
        setMappings(current => current.map(m => ({ ...m,
            path: m.path === source ? path : m.path,
            aliases: m.aliases.map(p => p === source ? path : p),
        })));
    }

    /** @brief Mount immediately in the specific namespace receiving the drop. */
    function mountTool(id: string, namespace: string, source?: string): void {
        const tool = view?.tools.find(t => t.id === id);
        const mapping = mappings.find(m => m.id === id);
        if (busy || !tool || mapping?.pinned || !paths.includes(namespace)) return;
        if (source && source !== mapping?.path && !mapping?.aliases.includes(source)) return;
        const previous = source || mapping?.path;
        const name = previous?.split('.').at(-1) || view?.effective.find(m => m.id === id)?.path.split('.').at(-1) ||
            tool.id.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(?=\d)/, '_');
        let path = `${namespace}.${name}`;
        if (path === previous) return;
        for (let suffix = 2; occupied(path, previous); suffix++) path = `${namespace}.${name}_${suffix}`;
        configureNamespace(namespace, {});
        if (previous) {
            configureNamespace(previous.split('.').slice(0, -1).join('.'), {});
            replacePath(previous, path);
        } else update(tool, { path });
        setStatus('已更新映射，请保存配置。');
    }

    /** @brief Rename only the mapped identifier, never the underlying physical tool. */
    function renameMapping(source: string, name: string): boolean {
        const mapping = mappings.find(m => m.path === source || m.aliases.includes(source));
        if (busy || !mapping || mapping.pinned) return false;
        const path = `${source.split('.').slice(0, -1).join('.')}.${name}`;
        if (!/^[a-zA-Z_$][\w$]*$/.test(name) || ['__proto__', 'prototype', 'constructor', 'then'].includes(name) || name.startsWith('__dsh') || occupied(path, source)) {
            setStatus('映射名称无效或与现有路径冲突。'); return false;
        }
        replacePath(source, path); setStatus('已更新映射名称，请保存配置。');
        return true;
    }

    /** @brief Remove a single mapping, promoting another mapped path when one remains. */
    function removeMapping(path: string): void {
        const mapping = mappings.find(m => m.path === path || m.aliases.includes(path));
        if (busy || !mapping || mapping.pinned) return;
        configureNamespace(path.split('.').slice(0, -1).join('.'), {});
        const remaining = [mapping.path, ...mapping.aliases].filter(p => p !== path);
        setMappings(current => current.flatMap(m => m.id !== mapping.id ? [m] : remaining.length ? [{ ...m, path: remaining[0]!, aliases: remaining.slice(1) }] : []));
        setStatus('已移除映射，请保存配置。');
    }

    return <div className="ts-intellisense">
        <style>{styles}</style>
        <header><h1>TypeScript 工具注册表</h1></header>
        {status && <p role="status" aria-live="polite">{status}</p>}
        <div className="ts-toolbar"><div className="ts-actions">
            <button disabled={busy} onClick={() => void action('正在刷新…', reload)}>刷新</button>
            <button disabled={busy || !view} onClick={() => void action('正在保存…', async () => {
                await request(api, { action: 'configure', sessionId, revision: view!.state.revision, namespaces, mappings: mappings.map(m => ({ ...m, path: m.path.trim(), aliases: m.aliases.map(alias => alias.trim()).filter(Boolean) })) });
                await reload();
            })}>保存配置</button>
            <select aria-label="会话配置" value={sessionId} disabled={busy} onChange={e => setSessionId(e.target.value)}>
                <option value="">全局</option>
                {view?.sessions.map(session => <option key={session.id} value={session.id}>{session.id}</option>)}
            </select>
            <button disabled={busy || !view?.sessions.length} onClick={() => void action('维护子代理正在生成整理提案…', async () => {
                setProposal(await request(api, { action: 'organize', sessionId })); setStatus('整理提案已生成，请审核后应用。');
            })}>生成整理提案</button>
            </div><div className="ts-actions"><input type="search" aria-label="搜索工具" placeholder="搜索名称、路径或描述" value={search} onChange={e => setSearch(e.target.value)} />
        </div></div>
        <main><section className="ts-namespaces"><h2>命名空间树</h2>
            <small>拖入具体命名空间或其提示区域即可映射；双击映射名重命名，双击空白提示添加命名空间。</small>
            <ul className="ts-tree">{paths.filter(path => !path.includes('.')).map(path => <NamespaceNode key={path} path={path}
                paths={paths} mappings={mappings} namespaces={namespaces} busy={busy || !view} configure={configureNamespace} drop={mountTool} create={createNamespace} rename={renameMapping} remove={removeMapping} tools={view?.tools ?? []} />)}
                <NamespacePlaceholder busy={busy || !view} create={createNamespace} />
            </ul>
            <small>unknown：{unknown} 个未挂载工具 · 执行权限由 DSH 原生策略判断。</small>
        </section><section className="ts-toolbox"><h2>工具积木 <small>{tools.length} 个工具</small></h2>
            <div className="ts-blocks">{tools.map(tool => <ToolBlock key={tool.id} tool={tool} mapping={mappings.find(m => m.id === tool.id)} busy={busy || !view} />)}</div>
            {view && !tools.length && <p>{filter ? '没有匹配的工具。' : '当前没有可用工具。'}</p>}
        </section></main>
        {proposal && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-proposal-title">
            <h2 id="ts-proposal-title">整理提案</h2><pre>{JSON.stringify(proposal.proposal, null, 2)}</pre>
            <p>应用后更新命名映射；执行权限仍由 DSH 原生策略判断。</p>
            <div className="ts-actions"><button disabled={busy} onClick={() => void action('正在应用提案…', async () => {
                await request(api, { action: 'approve', sessionId, id: proposal.id }); setProposal(undefined); await reload();
            })}>校验并应用</button><button disabled={busy} onClick={() => setProposal(undefined)}>取消</button></div>
        </section></div>}
    </div>;
}

const styles = `
.ts-intellisense{--ts-border:var(--dsw-alias-border-l2,#80808047);--ts-border-focus:var(--dsw-alias-label-secondary,#c8c8c8);font:14px system-ui,sans-serif;color:var(--dsw-alias-label-primary,#dce3ed);padding:16px;width:100%;min-width:0;box-sizing:border-box;background:transparent}
.ts-intellisense *{box-sizing:border-box}.ts-intellisense header{display:flex;align-items:center;gap:8px 24px;flex-wrap:wrap}.ts-intellisense h1{font-size:22px}.ts-intellisense h2{font-size:17px}.ts-intellisense h4{margin:12px 0 4px}
.ts-intellisense button,.ts-intellisense input,.ts-intellisense select{font:inherit;color:inherit;background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);padding:8px;transition:border-color .2s ease}
.ts-intellisense button{cursor:pointer}.ts-intellisense button:hover{background:linear-gradient(110deg,#ffffff08,#ffffff14)}.ts-intellisense :disabled{opacity:.5;cursor:default}
.ts-intellisense main{width:100%;min-width:0;display:flex;flex-direction:column;gap:24px;margin-top:24px}.ts-namespaces,.ts-toolbox{background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:16px;min-width:0;width:100%}
.ts-intellisense pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.ts-intellisense input[type=checkbox]{width:16px;height:16px;vertical-align:middle}
.ts-tree,.ts-tree ul{list-style:none;padding-left:24px}.ts-tree{padding-left:0;max-height:440px;overflow:auto}.ts-tree summary{padding:8px;border-radius:var(--dsw-radius-md,6px);cursor:pointer;border:1px solid var(--ts-border)}.ts-tree summary:hover{background:linear-gradient(110deg,#ffffff0a,transparent)}.ts-tree .ts-drop-over{background:linear-gradient(110deg,var(--dsw-alias-interactive-bg-hover,#ffffff0a),transparent);border:1px dashed var(--ts-border-focus)}
.ts-tree .ts-node-block{display:block;position:relative;padding-left:24px;transition:background .2s ease,border-color .2s ease}.ts-node-block::before{content:'▸';position:absolute;left:8px;top:10px;transition:transform .2s ease}.ts-tree details[open]>.ts-node-block::before{transform:rotate(90deg)}.ts-node-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}.ts-node-name{font-family:monospace;font-weight:600;overflow-wrap:anywhere;min-width:0}.ts-node-preview{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#a5a5a5);opacity:1;transform:translateY(0);transition:opacity .2s ease,transform .2s ease}.ts-node-block:is(:hover,:focus-within) .ts-node-preview{opacity:0;transform:translateY(-4px);pointer-events:none}.ts-node-visibility{display:flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto;opacity:0;visibility:hidden;pointer-events:none;transform:translateX(-8px);transition:opacity .2s ease,transform .2s ease,visibility 0s .2s}.ts-node-note{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-6px);transition:grid-template-rows .2s ease,opacity .2s ease,transform .2s ease,visibility 0s .2s}.ts-node-note>span{min-height:0;overflow:hidden}.ts-node-note input{display:block;width:100%;min-width:0;margin-top:8px}.ts-node-block:is(:hover,:focus-within) .ts-node-visibility,.ts-node-block:is(:hover,:focus-within) .ts-node-note{opacity:1;visibility:visible;pointer-events:auto;transform:translate(0);transition-delay:0s}.ts-node-block:is(:hover,:focus-within) .ts-node-note{grid-template-rows:1fr}.ts-tree-tool{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 12px;color:var(--dsw-alias-label-secondary,#bdbdbd);min-width:0}.ts-tree-tool code{cursor:text;overflow-wrap:anywhere}.ts-tree-tool small{overflow-wrap:anywhere}.ts-tree-tool>input{width:140px;max-width:100%;min-width:0}.ts-tree-tool button{padding:0 5px;font-size:13px}.ts-tree-tool[draggable=true]{cursor:grab}.ts-empty{color:var(--dsw-alias-label-tertiary,#a5a5a5);padding:12px}
.ts-blocks{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px 12px;padding:8px 0}.ts-tool{position:relative;border:1px solid var(--ts-border);border-left:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);background:transparent;padding:8px 10px;flex:0 0 auto;max-width:100%;min-width:0;overflow-wrap:anywhere;transition:box-shadow .15s,transform .15s,border-color .15s}.ts-tool:before{content:'';position:absolute;top:-6px;left:16px;width:26px;height:6px;border:1px solid var(--ts-border);border-bottom:0;border-radius:6px 6px 0 0;background:inherit}.ts-tool>code{display:block;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-tool[draggable=true]{cursor:grab}.ts-tool[draggable=true]:hover{transform:translateY(-2px);box-shadow:0 5px 14px #0003}.ts-tool[draggable=true]:active{cursor:grabbing}.ts-tool.ts-unmounted{background:transparent;color:var(--dsw-alias-state-error-primary,#ed8b8b)}.ts-namespace-placeholder>span{cursor:text;display:inline-block}.ts-namespace-placeholder>span:hover{color:var(--dsw-alias-label-primary,#dce3ed)}
.ts-intellisense [role=status]{white-space:pre-wrap;margin:16px 0;color:var(--dsw-alias-label-secondary,#bdbdbd)}.ts-intellisense small{color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-toolbar{display:flex;flex-direction:column;gap:8px;min-width:0}.ts-toolbar input[type=search]{width:100%;min-width:0}.ts-toolbar select{min-width:0;max-width:100%;flex:1 1 160px}.ts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.ts-tree details{margin:10px 0}
.ts-intellisense :is(input,select):focus,.ts-tree .ts-node-block:focus-within,.ts-namespaces:focus-within,.ts-toolbox:focus-within,.ts-tool:focus,.ts-tool:focus-within{border-color:var(--ts-border-focus);outline:none}
.ts-intellisense :is(button,summary,[role=button]):focus-visible{border-color:var(--ts-border-focus);outline:var(--dsw-focus-ring-width,1px) solid var(--ts-border-focus);outline-offset:2px}
.ts-tool:focus::before,.ts-tool:focus-within::before{border-color:var(--ts-border-focus)}

.ts-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.ts-backdrop section{background:transparent;backdrop-filter:blur(16px);border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:24px;width:min(1000px,85vw);max-height:85vh;overflow:auto}
`;
