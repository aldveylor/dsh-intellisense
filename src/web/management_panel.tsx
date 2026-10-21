import { useEffect, useState, type DragEvent } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState } from '../registry/registry.js';
import { validatePath } from '../registry/path.js';
import { ToolPicker } from './tool_picker/tool_picker.js';
import { useTreeDrag, treeDropTarget } from './tree_drag.js';
import { namespacePaths, orderedPaths, inNamespace, renameNamespace, deleteNamespace, dropTree, type TreeDragSource, type TreeDropTarget } from './namespace_tree.js';

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
    return <button className="ts-pin" type="button" aria-label={label} aria-pressed={active} data-filled={active}
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
        event.currentTarget.dataset.dropEdge = treeDropTarget(event.currentTarget, event.clientY).position;
    }
}

/** @brief Editable command mapping with direct pinning, deletion and sibling sorting. */
function MappedTool({ mapping, path, description, tree }: { mapping: Mapping; path: string; description?: string; tree: TreeProps }) {
    const invalid = !tree.tools.some(tool => tool.id === mapping.id);
    return <li className={`ts-tree-tool${invalid ? ' ts-tool-invalid' : ''}`} data-tool-status={invalid ? 'invalid' : 'available'} data-tree-path={path} data-tool-id={mapping.id} title={invalid ? '工具已失效，保留映射但不向 AI 提供' : description} draggable={!tree.busy && !mapping.pinned}
        onDragStart={event => {
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation();
            event.dataTransfer.setData('application/x-ts-tool', mapping.id);
            event.dataTransfer.setData('application/x-ts-mapping', path);
            event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy)} onDragLeave={event => { event.currentTarget.removeAttribute('data-drop-edge'); }} onDrop={event => tree.dropNode(event, path, false)}>
        <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={`映射名称 ${path}`} busy={tree.busy || mapping.pinned}
            commit={name => tree.rename(path, name)} />
        <span className="ts-mapping-source"><span aria-hidden="true">→ </span>{mapping.id}{invalid && <span role="status"> · 已失效</span>}</span>
        <span className="ts-tool-preview" title={description} role="button" tabIndex={tree.busy ? -1 : 0}
            onDoubleClick={() => tree.editDescription(mapping.id)} onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); tree.editDescription(mapping.id); }
            }}>{mapping.description ?? description ?? '双击编辑提示注释'}</span>
        <span className="ts-node-actions">
            <PinButton label={`一直显示命令 ${path}`} active={mapping.alwaysVisible ?? false} busy={tree.busy} toggle={() => tree.pinTool(mapping)} />
            <RemoveButton label={`移除映射 ${path}`} busy={tree.busy || mapping.pinned} remove={() => tree.remove(path)} />
        </span>
    </li>;
}

/** @brief Name a child namespace inline; empty names and Escape discard the pending entry. */
function NamespacePlaceholder({ parent = '', busy, create, drop, pick }: {
    parent?: string; busy: boolean; create: (path: string) => boolean; pick: (parent: string) => void;
    drop?: (event: DragEvent<HTMLElement>, parent: string) => void;
}) {
    const [name, setName] = useState<string>();
    const [over, setOver] = useState(false);

    /** @brief Start naming without changing the persisted namespace draft. */
    function begin(): void {
        if (!busy) setName('');
    }

    return <li data-namespace-path={parent} className={`ts-empty ts-namespace-placeholder ${over ? 'ts-drop-over' : ''}`}
        onDragOver={event => {
            if (!busy && event.dataTransfer.types.some(type => ['application/x-ts-tool', 'application/x-ts-namespace'].includes(type))) {
                event.preventDefault(); event.stopPropagation(); setOver(true);
            }
        }} onDragLeave={() => setOver(false)} onDrop={event => {
            event.preventDefault(); event.stopPropagation(); setOver(false);
            if (!busy) drop?.(event, parent);
        }}>
        {name === undefined ? <span role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
            title="双击添加命名空间" onDoubleClick={begin} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(); }
            }}>{parent ? '添加工具，双击创建命名空间' : '添加根命令，双击创建命名空间'}</span> : <input autoFocus aria-label={`命名新命名空间 ${parent || '根节点'}`}
            placeholder="命名空间名称" value={name} disabled={busy} onChange={event => setName(event.target.value)}
            onBlur={() => {
                const value = name.trim();
                if (!value || create(parent ? `${parent}.${value}` : value)) setName(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setName(undefined); }
            }} />}
        <button className="ts-add-tool" type="button" aria-label={`添加工具到 ${parent || '根节点'}`} title="选择工具积木" disabled={busy}
            onClick={() => pick(parent)} onDoubleClick={event => event.stopPropagation()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
    </li>;
}

/** @brief Shared namespace tree data and actions for recursively rendered mixed node types. */
interface TreeProps {
    paths: string[]; mappings: Mapping[]; namespaces: Namespace[]; tools: PhysicalTool[]; busy: boolean;
    order: string[]; expanded: Record<string, boolean>;
    configure: (path: string, patch: Partial<Namespace>) => void;
    drop: (event: DragEvent<HTMLElement>, parent: string) => void;
    pick: (parent: string) => void; create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    editDescription: (id: string) => void; remove: (path: string) => void; pinTool: (mapping: Mapping) => void;
    renameNamespace: (path: string, name: string) => boolean; deleteNamespace: (path: string) => void;
    toggle: (path: string) => void; dropNode: (event: DragEvent<HTMLElement>, path: string, namespace: boolean) => void;
}

/** @brief Namespace row whose children toggle only through the leading disclosure button. */
function NamespaceNode({ path, tree }: { path: string; tree: TreeProps }) {
    const config = tree.namespaces.find(n => n.path === path);
    const open = tree.expanded[path] ?? false;
    const children = tree.paths.filter(p => p.startsWith(`${path}.`) && p.split('.').length === path.split('.').length + 1);
    const mounted = tree.mappings.flatMap(mapping => [mapping.path, ...mapping.aliases].map(path => ({ path, mapping })))
        .filter(m => m.path.split('.').slice(0, -1).join('.') === path);
    const nodes = orderedPaths([...children, ...mounted.map(m => m.path)], tree.order);
    return <li data-tree-path={path}>
        <div className="ts-node-block" data-namespace-path={path} draggable={!tree.busy} onDragStart={event => {
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
        })}<NamespacePlaceholder parent={path} busy={tree.busy} create={tree.create} drop={tree.drop} pick={tree.pick} /></ul>}
    </li>;
}

/** @brief React registry editor with versioned drafts, schema inspection and explicit proposal approval. */
export function ManagementPanel({ api }: ManagementPanelProps) {
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [namespaces, setNamespaces] = useState<Namespace[]>([]);
    const [order, setOrder] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [descriptionEditor, setDescriptionEditor] = useState<{ id: string; text?: string }>();
    const [toolPicker, setToolPicker] = useState<string>();
    const [status, setStatus] = useState('正在加载…');
    const [busy, setBusy] = useState(false);
    const [proposal, setProposal] = useState<{ id: string; proposal: unknown }>();

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal): Promise<void> {
        const url = new URL(api, document.baseURI);
        const snapshot = await request<View>(url.href, undefined, signal);
        setView(snapshot); setMappings(structuredClone(snapshot.state.mappings));
        setNamespaces(structuredClone(snapshot.state.namespaces ?? []));
        setOrder(orderedPaths([...namespacePaths({ mappings: snapshot.state.mappings, namespaces: snapshot.state.namespaces ?? [] }), ...snapshot.state.mappings.flatMap(m => [m.path, ...m.aliases])], snapshot.state.order ?? []));
        setStatus('');
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setMappings([]); setNamespaces([]); setProposal(undefined); setOrder([]); setExpanded({}); setDescriptionEditor(undefined); setToolPicker(undefined); setStatus('正在加载…');
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

    const paths = namespacePaths({ mappings, namespaces });
    const unknown = view?.tools.filter(tool => !mappings.some(m => m.id === tool.id && m.path.trim())).length ?? 0;

    /** @brief Keep inferred and explicitly created namespaces in the same draft metadata model. */
    function configureNamespace(path: string, patch: Partial<Namespace>): void {
        setNamespaces(current => {
            const next = { path, alwaysVisible: false, description: '', ...current.find(n => n.path === path), ...patch };
            return current.some(n => n.path === path) ? current.map(n => n.path === path ? next : n) : [...current, next];
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

    /** @brief Rename only the mapped identifier, never the underlying physical tool. */
    function renameMapping(source: string, name: string): boolean {
        const mapping = mappings.find(m => m.path === source || m.aliases.includes(source));
        if (busy || !mapping || mapping.pinned) return false;
        const path = [...source.split('.').slice(0, -1), name].join('.');
        try { validatePath(path); } catch (error) { setStatus(String(error)); return false; }
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
        const parent = path.split('.').slice(0, -1).join('.');
        if (parent) configureNamespace(parent, {});
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

    /** @brief Commit one atomic drag operation for commands, namespaces and physical tool blocks. */
    function applyDrop(source: TreeDragSource, target: TreeDropTarget): void {
        if (busy || !view) return;
        try {
            if (!source.namespace && !view.tools.some(tool => tool.id === source.id)) return;
            const name = view.effective.find(m => m.id === source.id)?.path.split('.').at(-1) || source.id?.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(?=\d)/, '_');
            const next = dropTree({ mappings, namespaces, order }, source, target, name);
            if (source.namespace && source.path) {
                const parent = target.position === 'inside' ? target.path : target.path.split('.').slice(0, -1).join('.');
                const destination = [parent, source.path.split('.').at(-1)].filter(Boolean).join('.');
                setExpanded(current => Object.fromEntries(Object.entries(current).map(([path, open]) => [inNamespace(path, source.path!) ? destination + path.slice(source.path!.length) : path, open])));
            }
            setMappings(next.mappings); setNamespaces(next.namespaces); setOrder(next.order);
            setStatus('已更新工具位置，请保存配置。');
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }

    /** @brief Keep HTML drag compatibility while using the same center/edge resolution as pointer dragging. */
    function nativeDrop(event: DragEvent<HTMLElement>, target: TreeDropTarget): void {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.removeAttribute('data-drop-edge');
        const namespace = event.dataTransfer.getData('application/x-ts-namespace');
        applyDrop({ namespace: !!namespace, path: namespace || event.dataTransfer.getData('application/x-ts-mapping') || undefined, id: event.dataTransfer.getData('application/x-ts-tool') || undefined }, target);
    }
    const drag = useTreeDrag(applyDrop);

    const tree: TreeProps = {
        paths, mappings, namespaces, order, expanded, tools: view?.tools ?? [], busy: busy || !view,
        editDescription: id => { if (!busy) setDescriptionEditor({ id, text: mappings.find(m => m.id === id)?.description }); },
        pick: setToolPicker, configure: configureNamespace, drop: (event, parent) => nativeDrop(event, { path: parent, position: 'inside' }), create: createNamespace, rename: renameMapping, remove: removeMapping,
        pinTool: mapping => setMappings(current => current.map(m => m.id === mapping.id ? { ...m, alwaysVisible: !m.alwaysVisible } : m)),
        renameNamespace: (path, name) => editNamespace(path, name), deleteNamespace: path => { editNamespace(path); },
        toggle: path => setExpanded(current => ({ ...current, [path]: !(current[path] ?? false) })), dropNode: (event) => nativeDrop(event, treeDropTarget(event.currentTarget, event.clientY)),
    };

    return <div className="ts-intellisense" ref={drag.container} onPointerDownCapture={drag.pointerDown} onDragStartCapture={drag.preventNativeDrag}>
        <style>{styles}</style>
        <header><h1>TypeScript 工具注册表</h1></header>
        {status && <p role="status" aria-live="polite">{status}</p>}
        <div className="ts-toolbar"><div className="ts-actions">
            <button disabled={busy} onClick={() => void action('正在刷新…', reload)}>刷新</button>
            <button disabled={busy || !view} onClick={() => void action('正在保存…', async () => {
                await request(api, { action: 'configure', revision: view!.state.revision, namespaces, order: orderedPaths([...paths, ...mappings.flatMap(m => [m.path, ...m.aliases])], order), mappings: mappings.map(m => ({ ...m, path: m.path.trim(), aliases: m.aliases.map(alias => alias.trim()).filter(Boolean) })) });
                await reload();
            })}>保存配置</button>
            <span>全局配置</span>
            <button disabled={busy || !view?.sessions.length} onClick={() => void action('维护子代理正在生成整理提案…', async () => {
                setProposal(await request(api, { action: 'organize' })); setStatus('整理提案已生成，请审核后应用。');
            })}>生成整理提案</button>
        </div></div>
        <main><section className="ts-namespaces"><h2>命名空间树</h2>
            <small>箭头控制展开；双击名称或注释编辑，同级块可拖动排序，点击加号添加工具。</small>
            <ul className="ts-tree">{orderedPaths([...paths.filter(path => !path.includes('.')), ...mappings.flatMap(m => [m.path, ...m.aliases]).filter(path => !path.includes('.'))], order).map(path => {
                const command = mappings.find(m => m.path === path || m.aliases.includes(path));
                return command ? <MappedTool key={path} path={path} mapping={command} tree={tree}
                    description={view?.tools.find(tool => tool.id === command.id)?.description} /> : <NamespaceNode key={path} path={path} tree={tree} />;
            })}
                <NamespacePlaceholder busy={busy || !view} create={createNamespace} pick={setToolPicker} drop={(event, parent) => nativeDrop(event, { path: parent, position: 'inside' })} />
            </ul>
            <small>unknown：{unknown} 个未挂载工具</small>
        </section></main>
        {toolPicker !== undefined && view && <ToolPicker parent={toolPicker} tools={view.tools} mappings={mappings} busy={busy}
            close={() => setToolPicker(undefined)} select={tool => {
                applyDrop({ namespace: false, id: tool.id }, { path: toolPicker, position: 'inside' });
                setToolPicker(undefined);
            }} />}
        {descriptionEditor && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-description-title">
            <form onSubmit={event => {
                event.preventDefault();
                setMappings(current => current.map(m => m.id === descriptionEditor.id ? { ...m, description: descriptionEditor.text } : m));
                setDescriptionEditor(undefined); setStatus('已更新提示注释，请保存配置。');
            }}>
                <h2 id="ts-description-title">命令提示注释 · {descriptionEditor.id}</h2>
                <textarea aria-label="命令提示注释" autoFocus rows={8} value={descriptionEditor.text ?? view?.tools.find(t => t.id === descriptionEditor.id)?.description ?? ''}
                    onChange={event => setDescriptionEditor({ ...descriptionEditor, text: event.target.value })} />
                <div className="ts-actions"><button type="submit">应用</button>
                    <button type="button" onClick={() => setDescriptionEditor({ id: descriptionEditor.id })}>重置</button>
                    <button type="button" onClick={() => setDescriptionEditor(undefined)}>取消</button></div>
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
.ts-intellisense{--ts-border:var(--dsw-alias-border-l2,#80808047);--ts-border-focus:var(--dsw-alias-label-secondary,#c8c8c8);font:14px system-ui,sans-serif;color:var(--dsw-alias-label-primary,#dce3ed);padding:16px;width:100%;min-width:0;box-sizing:border-box;background:transparent}
.ts-intellisense *{box-sizing:border-box}.ts-intellisense header{display:flex;align-items:center;gap:8px 24px;flex-wrap:wrap}.ts-intellisense h1{font-size:22px}.ts-intellisense h2{font-size:17px}.ts-intellisense h4{margin:12px 0 4px}
.ts-intellisense button:not([data-dsh-control]),.ts-intellisense input,.ts-intellisense select,.ts-intellisense textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);padding:8px;transition:border-color .2s ease}
.ts-intellisense button{cursor:pointer}.ts-intellisense button:not([data-dsh-control]):hover{background:linear-gradient(110deg,#ffffff08,#ffffff14)}.ts-intellisense :disabled{opacity:.5;cursor:default}
.ts-intellisense main{width:100%;min-width:0;display:flex;flex-direction:column;gap:24px;margin-top:24px}.ts-namespaces{background:transparent;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:16px;min-width:0;width:100%}
.ts-intellisense pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.ts-intellisense input[type=checkbox]{width:16px;height:16px;vertical-align:middle}
.ts-tree,.ts-tree ul{list-style:none;padding-left:24px}.ts-tree{padding-left:0;max-height:440px;overflow:auto}.ts-tree .ts-drop-over{background:linear-gradient(110deg,var(--dsw-alias-interactive-bg-hover,#ffffff0a),transparent);border:1px dashed var(--ts-border-focus)}
.ts-node-block{display:flex;align-items:center;gap:10px;min-width:0;padding:4px 8px 4px 0;margin:10px 0;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);transition:border-color .2s ease}.ts-node-block[draggable=true]{cursor:grab}.ts-node-block:hover,.ts-tree-tool:hover{background:linear-gradient(110deg,#ffffff0a,transparent)}.ts-intellisense .ts-disclosure{display:inline-flex;align-items:center;justify-content:center;flex:0 0 40px;align-self:stretch;min-height:36px;padding:6px;border:0;border-radius:var(--dsw-radius-md,6px)}.ts-disclosure svg{transition:transform .2s ease}.ts-disclosure[aria-expanded=true] svg{transform:rotate(90deg)}.ts-node-name{font-family:monospace;font-weight:600;overflow-wrap:anywhere;min-width:0;cursor:text}.ts-node-preview{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#a5a5a5);cursor:text}.ts-node-block>input.ts-node-name{width:140px;max-width:35%}.ts-node-block>input.ts-node-preview{width:0;min-width:40px}.ts-node-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:0 0 auto}.ts-tree-tool{display:flex;gap:10px;align-items:center;padding:8px;min-width:0;border:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);margin:10px 0;transition:border-color .2s ease}.ts-dragging{user-select:none}.ts-drag-preview{position:fixed;top:0;left:0;z-index:10000;pointer-events:none;padding:8px 12px;border:1px solid var(--ts-border-focus);border-radius:6px;background:var(--dsw-alias-bg-base,#202020);opacity:.9}.ts-tree [data-drop-edge=inside]{background:var(--dsw-alias-interactive-bg-hover,#ffffff16);outline:1px dashed var(--ts-border-focus)}.ts-tree [data-drop-edge=before]{box-shadow:0 -2px 0 var(--ts-border-focus)}.ts-tree [data-drop-edge=after]{box-shadow:0 2px 0 var(--ts-border-focus)}.ts-intellisense .ts-tool-invalid{border-color:var(--dsw-alias-status-error,#df5656);background:#df565617;color:var(--dsw-alias-status-error,#df5656)}.ts-tool-invalid .ts-mapping-source{color:inherit}.ts-tree-tool:focus-within{border-color:var(--ts-border-focus)}.ts-tree-tool code{cursor:text;overflow-wrap:anywhere;font-weight:600}.ts-mapping-source{color:var(--dsw-alias-label-tertiary,#a5a5a5);font-size:12px;overflow-wrap:anywhere}.ts-tree-tool>input{width:140px;max-width:100%;min-width:0}.ts-tree-tool[draggable=true]{cursor:grab}.ts-tool-preview{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-intellisense .ts-remove,.ts-intellisense .ts-pin{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:26px;height:26px;padding:4px;border-color:transparent;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-node-actions .ts-remove,.ts-node-actions .ts-pin{margin-left:0}.ts-intellisense .ts-pin[aria-pressed=true]{color:var(--dsw-alias-label-primary,#dce3ed);border-color:transparent;background:transparent}.ts-pin[data-filled=true] svg{fill:currentColor}.ts-intellisense .ts-pin:hover{background:transparent}.ts-intellisense .ts-remove:hover,.ts-intellisense .ts-pin:hover{color:var(--dsw-alias-label-primary,#dce3ed)}.ts-empty{color:var(--dsw-alias-label-tertiary,#a5a5a5);padding:12px}
.ts-blocks{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px 12px;padding:8px 0}.ts-tool{position:relative;border:1px solid var(--ts-border);border-left:1px solid var(--ts-border);border-radius:var(--dsw-radius-md,6px);background:transparent;padding:8px 10px;flex:0 0 auto;max-width:100%;min-width:0;overflow-wrap:anywhere;transition:box-shadow .15s,transform .15s,border-color .15s}.ts-tool:before{content:'';position:absolute;top:-6px;left:16px;width:26px;height:6px;border:1px solid var(--ts-border);border-bottom:0;border-radius:6px 6px 0 0;background:inherit}.ts-tool>code{display:block;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-tool:focus::before{border-color:var(--ts-border-focus)}.ts-tool:not(:disabled){cursor:pointer}.ts-tool:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 5px 14px #0003}.ts-intellisense .ts-tool.ts-unmounted{background:transparent;color:var(--dsw-alias-state-error-primary,#ed8b8b)}.ts-namespace-placeholder{display:flex;align-items:center;gap:10px;border:1px dashed var(--ts-border);border-radius:var(--dsw-radius-md,6px);margin:10px 0;min-height:44px}.ts-namespace-placeholder:focus-within,.ts-namespace-placeholder:hover{border-color:var(--ts-border-focus)}.ts-namespace-placeholder>span{cursor:text;display:inline-block}.ts-intellisense .ts-add-tool{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:3px;flex:0 0 auto;border-color:transparent}.ts-namespace-placeholder>span:hover{color:var(--dsw-alias-label-primary,#dce3ed)}
.ts-intellisense [role=status]{white-space:pre-wrap;margin:16px 0;color:var(--dsw-alias-label-secondary,#bdbdbd)}.ts-intellisense small{color:var(--dsw-alias-label-tertiary,#a5a5a5)}.ts-toolbar{display:flex;flex-direction:column;gap:8px;min-width:0}.ts-toolbar input[type=search]{width:100%;min-width:0}.ts-toolbar .ts-configuration-select{flex:1 1 160px;min-width:0;max-width:100%}.ts-configuration-trigger{width:100%;min-width:0;justify-content:space-between}.ts-configuration-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ts-toolbar select{min-width:0;max-width:100%;flex:1 1 160px}.ts-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ts-intellisense :is(input,select):focus,.ts-tree .ts-node-block:focus-within,.ts-namespaces:focus-within,.ts-tool:focus,.ts-tool:focus-within{border-color:var(--ts-border-focus);outline:none}
.ts-intellisense :is(button:not([data-dsh-control]),summary,[role=button]):focus-visible{border-color:var(--ts-border-focus);outline:var(--dsw-focus-ring-width,1px) solid var(--ts-border-focus);outline-offset:2px}

.ts-backdrop textarea{width:100%;resize:vertical;margin:8px 0 16px;min-height:140px}.ts-backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center}.ts-backdrop section,.ts-tool-picker{background:transparent;backdrop-filter:blur(16px);border:1px solid var(--ts-border);border-radius:var(--dsw-radius-lg,10px);padding:24px;width:min(1000px,85vw);max-height:85vh;overflow:auto}
.ts-tool-picker{color:inherit}.ts-tool-picker::backdrop{background:#0008}.ts-tool-picker header{justify-content:space-between}.ts-tool-picker input[type=search]{width:100%;margin:8px 0 16px}.ts-tool-picker .ts-tool{text-align:left}.ts-tool-picker>small{display:block;margin-bottom:16px}
`;
