import { useEffect, useState, type DragEvent, type ComponentType } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';
import { validatePath } from '../registry/path.js';
import { namespacePaths, orderedPaths, inNamespace, renameNamespace, deleteNamespace, reorderTree } from './namespace_tree.js';

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
export interface ManagementPanelProps { api: string; ConfigurationSelect?: ComponentType<ConfigurationSelectProps> }

/** @brief Configuration selector contract shared by the host menu and standalone browser control. */
export interface ConfigurationSelectProps {
    value: string; disabled: boolean; sessions: Array<{ id: string }>; onChange: (value: string) => void;
}

/** @brief Standalone selection without requiring the host module loader. */
function StandaloneConfigurationSelect({ value, disabled, sessions, onChange }: ConfigurationSelectProps) {
    return <select aria-label="会话配置" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">全局</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.id}</option>)}
    </select>;
}

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

/** @brief A double-click text editor that keeps its draft local until explicit commit or blur. */
function EditableText({ value, label, className, busy, empty = false, commit }: {
    value: string; label: string; className: string; busy: boolean; empty?: boolean; commit: (value: string) => boolean;
}) {
    const [draft, setDraft] = useState<string>();
    return draft === undefined ? <span className={className} title={value || label} role="button" tabIndex={busy ? -1 : 0}
        onDoubleClick={() => { if (!busy) setDraft(value); }} onKeyDown={event => {
            if (!busy && event.key === 'Enter') { event.preventDefault(); setDraft(value); }
        }}>{value || '双击添加注释'}</span> : <input className={className} aria-label={label} autoFocus value={draft} disabled={busy}
            onChange={event => setDraft(event.target.value)} onBlur={() => {
                const next = draft.trim();
                if ((!empty && !next) || next === value || commit(next)) setDraft(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setDraft(undefined); }
            }} />;
}

/** @brief Shared always-visible pin control for namespace and command prompt exposure. */
function PinButton({ label, active, busy, toggle }: { label: string; active: boolean; busy: boolean; toggle: () => void }) {
    return <button className="ts-pin" type="button" aria-label={label} aria-pressed={active}
        title={active ? '取消固定显示' : '固定显示'} disabled={busy} onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="m16 9 3-3-5-5-3 3v4l-5 5 5 5 5-5zM9 15l-5 5" />
        </svg>
    </button>;
}

/** @brief Shared deletion control placed after the pin at the right edge of tree blocks. */
function RemoveButton({ label, busy, remove }: { label: string; busy: boolean; remove: () => void }) {
    return <button className="ts-remove" type="button" aria-label={label} title={label} disabled={busy} onClick={remove}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
        </svg>
    </button>;
}

/** @brief Mark a node as a drag target without intercepting ordinary text editing. */
function acceptTreeDrag(event: DragEvent<HTMLElement>, busy: boolean): void {
    if (!busy && event.dataTransfer.types.some(type => ['application/x-ts-tool', 'application/x-ts-namespace'].includes(type))) {
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dataset.dropEdge = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
    }
}

/** @brief Editable command mapping with direct pinning, deletion and sibling sorting. */
function MappedTool({ mapping, path, description, tree }: { mapping: Mapping; path: string; description?: string; tree: TreeProps }) {
    return <li className="ts-tree-tool" data-tree-path={path} title={description} draggable={!tree.busy && !mapping.pinned}
        onDragStart={event => {
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation();
            event.dataTransfer.setData('application/x-ts-tool', mapping.id);
            event.dataTransfer.setData('application/x-ts-mapping', path);
            event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy)} onDragLeave={event => { event.currentTarget.removeAttribute('data-drop-edge'); }} onDrop={event => tree.dropNode(event, path, false)}>
        <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={`映射名称 ${path}`} busy={tree.busy || mapping.pinned}
            commit={name => tree.rename(path, name)} />
        <span className="ts-mapping-source"><span aria-hidden="true">→ </span>{mapping.id}</span>
        {description && <span className="ts-tool-preview">{description}</span>}
        <span className="ts-node-actions">
            <PinButton label={`一直显示命令 ${path}`} active={mapping.alwaysVisible ?? false} busy={tree.busy} toggle={() => tree.pinTool(mapping)} />
            <RemoveButton label={`移除映射 ${path}`} busy={tree.busy || mapping.pinned} remove={() => tree.remove(path)} />
        </span>
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

/** @brief Shared namespace tree data and actions for recursively rendered mixed node types. */
interface TreeProps {
    paths: string[]; mappings: Mapping[]; namespaces: Namespace[]; tools: PhysicalTool[]; busy: boolean;
    order: string[]; expanded: Record<string, boolean>;
    configure: (path: string, patch: Partial<Namespace>) => void;
    drop: (id: string, path: string, source?: string) => void;
    create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    remove: (path: string) => void; pinTool: (mapping: Mapping) => void;
    renameNamespace: (path: string, name: string) => boolean; deleteNamespace: (path: string) => void;
    toggle: (path: string) => void; dropNode: (event: DragEvent<HTMLElement>, path: string, namespace: boolean) => void;
}

/** @brief Namespace row whose children toggle only through the leading disclosure button. */
function NamespaceNode({ path, tree }: { path: string; tree: TreeProps }) {
    const config = tree.namespaces.find(n => n.path === path);
    const open = tree.expanded[path] ?? true;
    const children = tree.paths.filter(p => p.startsWith(`${path}.`) && p.split('.').length === path.split('.').length + 1);
    const mounted = tree.mappings.flatMap(mapping => [mapping.path, ...mapping.aliases].map(path => ({ path, mapping })))
        .filter(m => m.path.split('.').slice(0, -1).join('.') === path);
    const nodes = orderedPaths([...children, ...mounted.map(m => m.path)], tree.order);
    return <li data-tree-path={path}>
        <div className="ts-node-block" draggable={!tree.busy} onDragStart={event => {
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-namespace', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy)} onDragLeave={event => { event.currentTarget.removeAttribute('data-drop-edge'); }} onDrop={event => tree.dropNode(event, path, true)}>
            <button className="ts-disclosure" type="button" aria-label={`展开或收起 ${path}`} aria-expanded={open} disabled={tree.busy}
                onClick={() => tree.toggle(path)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
            <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={`命名空间名称 ${path}`} busy={tree.busy}
                commit={name => tree.renameNamespace(path, name)} />
            <EditableText className="ts-node-preview" value={config?.description ?? ''} label={`命名空间注释 ${path}`} busy={tree.busy} empty
                commit={description => { tree.configure(path, { description }); return true; }} />
            <span className="ts-node-actions">
                <PinButton label={`一直显示 ${path}`} active={config?.alwaysVisible ?? false} busy={tree.busy}
                    toggle={() => tree.configure(path, { alwaysVisible: !config?.alwaysVisible })} />
                <RemoveButton label={`删除命名空间 ${path}`} busy={tree.busy} remove={() => tree.deleteNamespace(path)} />
            </span>
        </div>
        {open && <ul>{nodes.map(node => {
            const command = mounted.find(m => m.path === node);
            return command ? <MappedTool key={node} path={node} mapping={command.mapping} tree={tree}
                description={tree.tools.find(t => t.id === command.mapping.id)?.description} /> : <NamespaceNode key={node} path={node} tree={tree} />;
        })}<NamespacePlaceholder parent={path} busy={tree.busy} create={tree.create} drop={tree.drop} /></ul>}
    </li>;
}

/** @brief React registry editor with versioned drafts, schema inspection and explicit proposal approval. */
export function ManagementPanel({ api, ConfigurationSelect = StandaloneConfigurationSelect }: ManagementPanelProps) {
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [namespaces, setNamespaces] = useState<Namespace[]>([]);
    const [order, setOrder] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
        setOrder(structuredClone(snapshot.state.order ?? []));
        setStatus('');
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setMappings([]); setNamespaces([]); setProposal(undefined); setOrder([]); setExpanded({}); setStatus('正在加载…');
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
    const paths = namespacePaths({ mappings, namespaces });
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
        try { validatePath(`${path}.namespace_check`); } catch (error) { setStatus(String(error)); return false; }
        configureNamespace(path, {}); setOrder(current => [...current, path]);
        return true;
    }

    /** @brief Detect collisions across all callable mappings and namespace nodes. */
    function occupied(path: string, source?: string): boolean {
        return paths.includes(path) || mappings.flatMap(m => [m.path, ...m.aliases]).filter(p => p !== source)
            .some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`));
    }

    /** @brief Replace one mapped path while keeping the tool's physical identity intact. */
    function replacePath(source: string, path: string): void {
        setOrder(current => current.map(p => p === source ? path : p));
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
        } else { update(tool, { path }); setOrder(current => [...current, path]); }
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

    /** @brief Apply subtree edits atomically to the local draft and retain disclosure state across renames. */
    function editNamespace(source: string, name?: string): boolean {
        if (busy || !view) return false;
        try {
            const draft = { mappings, namespaces, order };
            const next = name === undefined ? deleteNamespace(draft, source) : renameNamespace(draft, source, name);
            setMappings(next.mappings); setNamespaces(next.namespaces); setOrder(next.order);
            if (name !== undefined) {
                const target = [...source.split('.').slice(0, -1), name].join('.');
                setExpanded(current => Object.fromEntries(Object.entries(current).map(([path, open]) => [inNamespace(path, source) ? target + path.slice(source.length) : path, open])));
            } else setExpanded(current => Object.fromEntries(Object.entries(current).filter(([path]) => !inNamespace(path, source))));
            setStatus('已更新命名空间，请保存配置。'); return true;
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return false; }
    }

    /** @brief Drop sibling tree blocks before or after one another, or mount a tool inside a namespace. */
    function dropNode(event: DragEvent<HTMLElement>, target: string, namespace: boolean): void {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.removeAttribute('data-drop-edge');
        if (busy || !view) return;
        const source = event.dataTransfer.getData('application/x-ts-namespace') || event.dataTransfer.getData('application/x-ts-mapping');
        if (source && source.split('.').slice(0, -1).join('.') === target.split('.').slice(0, -1).join('.')) {
            const rect = event.currentTarget.getBoundingClientRect();
            setOrder(reorderTree({ mappings, namespaces, order }, source, target, event.clientY > rect.top + rect.height / 2));
            setStatus('已更新排序，请保存配置。');
        } else if (namespace && !event.dataTransfer.getData('application/x-ts-namespace')) {
            mountTool(event.dataTransfer.getData('application/x-ts-tool'), target, source);
        }
    }

    const tree: TreeProps = {
        paths, mappings, namespaces, order, expanded, tools: view?.tools ?? [], busy: busy || !view,
        configure: configureNamespace, drop: mountTool, create: createNamespace, rename: renameMapping, remove: removeMapping,
        pinTool: mapping => setMappings(current => current.map(m => m.id === mapping.id ? { ...m, alwaysVisible: !m.alwaysVisible } : m)),
        renameNamespace: (path, name) => editNamespace(path, name), deleteNamespace: path => { editNamespace(path); },
        toggle: path => setExpanded(current => ({ ...current, [path]: !(current[path] ?? true) })), dropNode,
    };

    return <div className="ts-intellisense">
        <style>{styles}</style>
        <header><h1>TypeScript 工具注册表</h1></header>
        {status && <p role="status" aria-live="polite">{status}</p>}
        <div className="ts-toolbar"><div className="ts-actions">
            <button disabled={busy} onClick={() => void action('正在刷新…', reload)}>刷新</button>
            <button disabled={busy || !view} onClick={() => void action('正在保存…', async () => {
                await request(api, { action: 'configure', sessionId, revision: view!.state.revision, namespaces, order, mappings: mappings.map(m => ({ ...m, path: m.path.trim(), aliases: m.aliases.map(alias => alias.trim()).filter(Boolean) })) });
                await reload();
            })}>保存配置</button>
            <ConfigurationSelect value={sessionId} disabled={busy} sessions={view?.sessions ?? []} onChange={setSessionId} />
            <button disabled={busy || !view?.sessions.length} onClick={() => void action('维护子代理正在生成整理提案…', async () => {
                setProposal(await request(api, { action: 'organize', sessionId })); setStatus('整理提案已生成，请审核后应用。');
            })}>生成整理提案</button>
            </div><div className="ts-actions"><input type="search" aria-label="搜索工具" placeholder="搜索名称、路径或描述" value={search} onChange={e => setSearch(e.target.value)} />
        </div></div>
        <main><section className="ts-namespaces"><h2>命名空间树</h2>
            <small>箭头控制展开；双击名称或注释编辑，同级块可拖动排序，拖到命名空间内可映射工具。</small>
            <ul className="ts-tree">{orderedPaths(paths.filter(path => !path.includes('.')), order).map(path => <NamespaceNode key={path} path={path} tree={tree} />)}
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
.ts-intellisense button:not([data-dsh-control]),.ts-intellisense input,.ts-intellisense select{font:inherit;color:inherit;background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);padding:8px;transition:border-color .2s ease}
.ts-intellisense button{cursor:pointer}.ts-intellisense button:not([data-dsh-control]):hover{background:linear-gradient(110deg,#ffffff08,#ffffff14)}.ts-intellisense :disabled{opacity:.5;cursor:default}
.ts-intellisense main{width:100%;min-width:0;display:flex;flex-direction:column;gap:24px;margin-top:24px}.ts-namespaces,.ts-toolbox{background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:16px;min-width:0;width:100%}
.ts-intellisense pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.ts-intellisense input[type=checkbox]{width:16px;height:16px;vertical-align:middle}
.ts-tree,.ts-tree ul{list-style:none;padding-left:24px}.ts-tree{padding-left:0;max-height:440px;overflow:auto}.ts-tree .ts-drop-over{background:linear-gradient(110deg,var(--dsw-alias-interactive-bg-hover,#ffffff0a),transparent);border:1px dashed var(--ts-border-focus)}
.ts-node-block{display:flex;align-items:center;gap:10px;min-width:0;padding:4px 8px 4px 0;margin:10px 0;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);transition:border-color .2s ease}.ts-node-block[draggable=true]{cursor:grab}.ts-node-block:hover,.ts-tree-tool:hover{background:linear-gradient(110deg,#ffffff0a,transparent)}.ts-intellisense .ts-disclosure{display:inline-flex;align-items:center;justify-content:center;flex:0 0 40px;align-self:stretch;min-height:36px;padding:6px;border:0;border-radius:var(--dsw-radius-md,6px)}.ts-disclosure svg{transition:transform .2s ease}.ts-disclosure[aria-expanded=true] svg{transform:rotate(90deg)}.ts-node-name{font-family:monospace;font-weight:600;overflow-wrap:anywhere;min-width:0;cursor:text}.ts-node-preview{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#a5a5a5);cursor:text}.ts-node-block>input.ts-node-name{width:140px;max-width:35%}.ts-node-block>input.ts-node-preview{width:0;min-width:40px}.ts-node-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:0 0 auto}.ts-tree-tool{display:flex;gap:10px;align-items:center;padding:8px;min-width:0;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);margin:10px 0;transition:border-color .2s ease}.ts-tree [data-drop-edge=before]{box-shadow:0 -2px 0 var(--ts-border-focus)}.ts-tree [data-drop-edge=after]{box-shadow:0 2px 0 var(--ts-border-focus)}.ts-tree-tool:focus-within{border-color:var(--ts-border-focus)}.ts-tree-tool code{cursor:text;overflow-wrap:anywhere;font-weight:600}.ts-mapping-source{color:var(--dsw-alias-label-tertiary,#a5a5a5);font-size:12px;overflow-wrap:anywhere}.ts-tree-tool>input{width:140px;max-width:100%;min-width:0}.ts-tree-tool[draggable=true]{cursor:grab}.ts-tool-preview{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-intellisense .ts-remove,.ts-intellisense .ts-pin{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:26px;height:26px;padding:4px;border-color:transparent;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-node-actions .ts-remove,.ts-node-actions .ts-pin{margin-left:0}.ts-intellisense .ts-pin[aria-pressed=true]{color:var(--dsw-alias-label-primary,#dce3ed);border-color:transparent;background:transparent}.ts-pin[aria-pressed=true] svg{fill:currentColor}.ts-intellisense .ts-pin:hover{background:transparent}.ts-intellisense .ts-remove:hover,.ts-intellisense .ts-pin:hover{color:var(--dsw-alias-label-primary,#dce3ed)}.ts-empty{color:var(--dsw-alias-label-tertiary,#a5a5a5);padding:12px}
.ts-blocks{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px 12px;padding:8px 0}.ts-tool{position:relative;border:1px solid var(--ts-border);border-left:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);background:transparent;padding:8px 10px;flex:0 0 auto;max-width:100%;min-width:0;overflow-wrap:anywhere;transition:box-shadow .15s,transform .15s,border-color .15s}.ts-tool:before{content:'';position:absolute;top:-6px;left:16px;width:26px;height:6px;border:1px solid var(--ts-border);border-bottom:0;border-radius:6px 6px 0 0;background:inherit}.ts-tool>code{display:block;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-tool:focus::before{border-color:var(--ts-border-focus)}.ts-tool[draggable=true]{cursor:grab}.ts-tool[draggable=true]:hover{transform:translateY(-2px);box-shadow:0 5px 14px #0003}.ts-tool[draggable=true]:active{cursor:grabbing}.ts-tool.ts-unmounted{background:transparent;color:var(--dsw-alias-state-error-primary,#ed8b8b)}.ts-namespace-placeholder>span{cursor:text;display:inline-block}.ts-namespace-placeholder>span:hover{color:var(--dsw-alias-label-primary,#dce3ed)}
.ts-intellisense [role=status]{white-space:pre-wrap;margin:16px 0;color:var(--dsw-alias-label-secondary,#bdbdbd)}.ts-intellisense small{color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-toolbar{display:flex;flex-direction:column;gap:8px;min-width:0}.ts-toolbar input[type=search]{width:100%;min-width:0}.ts-toolbar .ts-configuration-select{flex:1 1 160px;min-width:0;max-width:100%}.ts-configuration-trigger{width:100%;min-width:0;justify-content:space-between}.ts-configuration-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ts-toolbar select{min-width:0;max-width:100%;flex:1 1 160px}.ts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ts-intellisense :is(input,select):focus,.ts-tree .ts-node-block:focus-within,.ts-namespaces:focus-within,.ts-toolbox:focus-within,.ts-tool:focus,.ts-tool:focus-within{border-color:var(--ts-border-focus);outline:none}
.ts-intellisense :is(button:not([data-dsh-control]),summary,[role=button]):focus-visible{border-color:var(--ts-border-focus);outline:var(--dsw-focus-ring-width,1px) solid var(--ts-border-focus);outline-offset:2px}

.ts-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.ts-backdrop section{background:transparent;backdrop-filter:blur(16px);border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:24px;width:min(1000px,85vw);max-height:85vh;overflow:auto}
`;
