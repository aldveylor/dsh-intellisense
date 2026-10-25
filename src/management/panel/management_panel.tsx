import { useTranslation } from '../locale/locale.js';
import styles from './management_panel.css';
import { ErrorDialog } from './error_dialog.js';
import { NamespaceTree, type TreeNode, type CommandTreeNode, type NamespaceTreeNode } from './tree_node.js';
import { useEffect, useState, type ComponentType, type DragEvent } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState, PinLevel, CommandVisibility, RegistryConfiguration } from '../../registry/registry.js';
import { pluginCommands } from '../../runtime/builtins.js';
import { validatePath } from '../../registry/path.js';
import { TreeProvider, unmountedTools } from './tree_provider.js';
import { ProfilePicker, ProfileSelect as PortableProfileSelect, type ProfileSelectProps } from '../profile_picker/profile_picker.js';
import { ToolPicker } from '../tool_picker/tool_picker.js';
import { useTreeDrag, treeDropTarget, showTreeDropFeedback, clearTreeDropFeedback } from './tree_drag.js';
import { isFixedNamespace, namespacePaths, orderedPaths, inNamespace, renameNamespace, deleteNamespace, dropTree, type TreeDragSource, type TreeDropTarget } from './namespace_tree.js';

/** @brief Authenticated management metadata, shared by embedded and standalone React views. */
interface View {
    defaultProfile: string;
    state: RegistryState;
    tools: PhysicalTool[];
    effective: Array<Mapping & { tool: PhysicalTool }>;
}

/** @brief Shared editor inputs; the mounting surface supplies its authenticated API URL. */
export interface ManagementPanelProps { api: string; ProfileSelect?: ComponentType<ProfileSelectProps>; organize?: (prompt: string) => Promise<void> }

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

/** @brief Normalize the same Profile configuration for comparison and persistence. */
function profileDraft(state: Pick<RegistryState, keyof RegistryConfiguration>): RegistryConfiguration {
    const mappings = state.mappings.map(mapping => ({ ...mapping, path: mapping.path.trim(), aliases: mapping.aliases.map(alias => alias.trim()).filter(Boolean) }));
    const namespaces = state.namespaces ?? [];
    const paths = [...TreeProvider(state.builtinVisible ?? pluginCommands.defaultBuiltinVisible).map(node => node.path), ...namespacePaths({ mappings, namespaces }), ...mappings.flatMap(mapping => [mapping.path, ...mapping.aliases])];
    return {
        mappings, namespaces, unmountedVisible: state.unmountedVisible ?? {}, builtinVisible: state.builtinVisible ?? pluginCommands.defaultBuiltinVisible,
        builtinDisabled: state.builtinDisabled ?? [], consolePinned: state.consolePinned ?? false, toolComments: state.toolComments ?? {},
        order: orderedPaths([...new Set(paths)], (state.order ?? []).map(path => path.trim())),
    };
}

/** @brief A double-click text editor that keeps its draft local until explicit commit or blur. */
function EditableText({ value, label, className, busy, empty = false, commit }: {
    value: string; label: string; className: string; busy: boolean; empty?: boolean; commit: (value: string) => boolean;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();
    return draft === undefined ? <span className={className} title={value || label} role="button" tabIndex={busy ? -1 : 0}
        onDoubleClick={() => { if (!busy) setDraft(value); }} onKeyDown={event => {
            if (!busy && event.key === 'Enter') { event.preventDefault(); setDraft(value); }
        }}>{value || t('add_comment')}</span> : <input className={className} aria-label={label} autoFocus value={draft} disabled={busy}
            onChange={event => setDraft(event.target.value)} onBlur={() => {
                const next = draft.trim();
                if ((!empty && !next) || next === value || commit(next)) setDraft(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setDraft(undefined); }
            }} />;
}

/** @brief Cycle command prompt exposure from hidden to brief to detailed. */
function nextPinLevel(level: PinLevel): PinLevel { return ((level + 1) % 3) as PinLevel; }

/** @brief Shared always-visible pin control for namespace and command prompt exposure. */
function PinButton({ label, active, busy, locked = false, level, tooltip, toggle }: { tooltip?: string; label: string; active: boolean; busy: boolean; locked?: boolean; level?: PinLevel; toggle: () => void }) {
    const t = useTranslation();
    return <button className="ts-pin" type="button" aria-label={label} aria-pressed={active} data-filled={active} data-level={level}
        title={tooltip ?? (level !== undefined ? t(`pin_level_${level}`) : locked ? t('builtin_pinned') : active ? t('unpin') : t('pin'))} disabled={busy || locked} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="m16 9 3-3-5-5-3 3v4l-5 5 5 5 5-5zM9 15l-5 5" />
        </svg>
    </button>;
}

/** @brief Shared deletion control placed after the pin at the right edge of tree blocks. */
function RemoveButton({ label, busy, remove }: { label: string; busy: boolean; remove: () => void }) {
    return <button className="ts-remove" type="button" aria-label={label} title={label} disabled={busy} onClick={remove}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
        </svg>
    </button>;
}

/** @brief Toggle command or namespace availability while retaining its editable tree node. */
function DisableButton({ disabled, busy, toggle }: { disabled: boolean; busy: boolean; toggle: () => void }) {
    const t = useTranslation();
    const label = t(disabled ? 'enable_node' : 'disable_node');
    return <button className="ts-disable ts-remove" type="button" aria-label={label} title={label} aria-pressed={disabled} disabled={busy} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d={disabled ? 'M8 12h8M12 8v8' : 'm6 6 12 12'} /></svg>
    </button>;
}

/** @brief Mark a node as a drag target without intercepting ordinary text editing. */
function acceptTreeDrag(event: DragEvent<HTMLElement>, busy: boolean): void {
    if (event.currentTarget.dataset.dropDisabled === 'true') { event.stopPropagation(); return; }
    if (!busy && event.dataTransfer.types.some(type => ['application/x-ts-tool', 'application/x-ts-namespace'].includes(type))) {
        event.preventDefault(); event.stopPropagation();
        showTreeDropFeedback(event.currentTarget, event.clientY);
    }
}

/** @brief Render commands with shared fixed, read-only and movement policies supplied by their data source. */
function CommandNode({ node, tree }: { node: CommandTreeNode; tree: TreeProps }) {
    const t = useTranslation();
    const { path, mapping, command, fixed, description } = node;
    const id = mapping?.id ?? command?.id;
    const readOnly = node.fixed;
    const invalid = !!mapping && !tree.tools.some(tool => tool.id === id);
    const draggable = !tree.busy && node.draggable;
    return <li className={`ts-tree-tool${fixed ? ' ts-fixed-node' : ''}${invalid ? ' ts-tool-invalid' : ''}`}
        aria-disabled={tree.disabled(path) || undefined} data-tool-status={tree.disabled(path) ? 'disabled' : invalid ? 'invalid' : 'available'} data-tree-path={path} data-tool-id={id} data-drop-disabled={readOnly || undefined}
        title={invalid ? t('invalid_tool') : description} draggable={draggable}
        onDragStart={event => {
            if (!draggable || (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-tool', id!);
            event.dataTransfer.setData('application/x-ts-mapping', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || readOnly)}
        onDragLeave={() => clearTreeDropFeedback()}
        onDrop={event => { if (readOnly) { event.preventDefault(); event.stopPropagation(); } else tree.dropNode(event, path, false); }}>
        {readOnly ? <code title={`${command?.signature ?? path}\n${description ?? ''}`}>{path.split('.').at(-1)}</code> :
            <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('mapping_name', { path })} busy={tree.busy || !!mapping?.pinned}
                commit={name => tree.rename(path, name)} />}
        {id && <span className="ts-mapping-source"><span aria-hidden="true">→ </span>{id}{invalid && <span role="status"> · {t('unavailable')}</span>}</span>}
        <span className="ts-tool-preview" title={description} role={fixed ? undefined : 'button'} tabIndex={fixed ? undefined : tree.busy ? -1 : 0}
            onDoubleClick={() => { if (!fixed && id) tree.editDescription(id); }} onKeyDown={event => {
                if (!fixed && id && event.key === 'Enter') { event.preventDefault(); tree.editDescription(id); }
            }}>{(id && Object.hasOwn(tree.toolComments, id) ? tree.toolComments[id] : undefined) ?? mapping?.description ?? description ?? t('edit_comment')}</span>
        <span className="ts-node-actions">
            <PinButton label={t('pin_command', { path })} active={!!(command?.alwaysVisible ?? mapping?.alwaysVisible)} level={command?.alwaysVisible ?? mapping?.alwaysVisible ?? 0} busy={tree.busy || !!command?.disabled || path === 'tools.intellisense'}
                toggle={() => { if (command) tree.pinBuiltin(command.path); else if (mapping) tree.pinTool(mapping); else if (id) tree.pinUnmounted(id); }} />
            {path !== 'tools.intellisense' && <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />}
            {!readOnly && <RemoveButton label={t('remove_mapping', { path })} busy={tree.busy || !!mapping?.pinned} remove={() => tree.remove(path)} />}
        </span>
    </li>;
}

/** @brief Name a child namespace inline; empty names and Escape discard the pending entry. */
function NamespacePlaceholder({ parent = '', busy, create, drop, pick }: {
    parent?: string; busy: boolean; create: (path: string) => boolean; pick: (parent: string) => void;
    drop?: (event: DragEvent<HTMLElement>, parent: string) => void;
}) {
    const t = useTranslation();
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
            title={t('add_namespace')} onDoubleClick={begin} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(); }
            }}>{parent ? t('add_tools_hint') : t('add_root_hint')}</span> : <input autoFocus aria-label={t('name_namespace', { path: parent || t('root') })}
            placeholder={t('namespace_name')} value={name} disabled={busy} onChange={event => setName(event.target.value)}
            onBlur={() => {
                const value = name.trim();
                if (!value || create(parent ? `${parent}.${value}` : value)) setName(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setName(undefined); }
            }} />}
        <button className="ts-add-tool" type="button" aria-label={t('add_tools_to', { path: parent || t('root') })} title={t('choose_tools')} disabled={busy}
            onClick={() => pick(parent)} onDoubleClick={event => event.stopPropagation()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
    </li>;
}

/** @brief Shared namespace tree data and actions for recursively rendered mixed node types. */
interface TreeProps {
    disabled: (path: string) => boolean; toggleDisabled: (path: string) => void;
    tools: PhysicalTool[]; busy: boolean;
    expanded: Record<string, boolean>;
    configure: (path: string, patch: Partial<Namespace>) => void;
    drop: (event: DragEvent<HTMLElement>, parent: string) => void;
    pick: (parent: string) => void; create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    editDescription: (id: string) => void; remove: (path: string) => void; pinTool: (mapping: Mapping) => void;
    renameNamespace: (path: string, name: string) => boolean; deleteNamespace: (path: string) => void;
    toggle: (path: string) => void; dropNode: (event: DragEvent<HTMLElement>, path: string, namespace: boolean) => void;
    consolePinned: boolean; toggleConsole: () => void;
    pinBuiltin: (path: string) => void; toolComments: Record<string, string>; unmountedVisible: CommandVisibility; pinUnmounted: (id: string) => void;
}

/** @brief Namespace row whose children toggle only through the leading disclosure button. */
function NamespaceNode({ node, tree }: { node: NamespaceTreeNode; tree: TreeProps }) {
    const t = useTranslation();
    const { path, fixed, metadata: config, count } = node;
    const open = tree.expanded[path] ?? false;
    return <li data-tree-path={path} data-disabled={tree.disabled(path) || undefined}>
        <div className={`ts-node-block${fixed ? ' ts-fixed-node' : ''}`} data-namespace-path={path} data-drop-disabled={fixed || undefined} draggable={!tree.busy && !fixed} onDragStart={event => {
            if (fixed) { event.preventDefault(); return; }
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-namespace', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || fixed)} onDragLeave={() => clearTreeDropFeedback()} onDrop={event => tree.dropNode(event, path, true)}>
            <button className="ts-disclosure" type="button" aria-label={t('toggle_namespace', { path })} aria-expanded={open} disabled={tree.busy}
                onClick={() => tree.toggle(path)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
            {fixed ? <span className="ts-node-name" title={path}>{path.split('.').at(-1)}</span> : <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('namespace_path_name', { path })} busy={tree.busy}
                commit={name => tree.renameNamespace(path, name)} />}
            <small className="ts-node-count" aria-label={t('command_count', { path })}>{count}</small>
            {fixed ? <span className="ts-node-preview">{node.description}</span> : <><EditableText className="ts-node-preview" value={config?.description ?? ''} label={t('namespace_comment', { path })} busy={tree.busy} empty
                commit={description => { tree.configure(path, { description }); return true; }} />
            <span className="ts-node-actions">
                <PinButton label={t('pin_namespace', { path })} active={config?.alwaysVisible ?? false} busy={tree.busy}
                    toggle={() => tree.configure(path, { alwaysVisible: !config?.alwaysVisible })} />
                <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />
                <RemoveButton label={t('delete_namespace', { path })} busy={tree.busy} remove={() => tree.deleteNamespace(path)} />
            </span></>}
            {node.pinMode === 'locked' && <span className="ts-node-actions">
                <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />
                <PinButton label={t('fixed_namespace')} tooltip={t('fixed_namespace')} active busy={tree.busy} locked toggle={() => {}} />
            </span>}
            {node.pinMode === 'console' && <span className="ts-node-actions">
                <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />
                <PinButton label={t('pin_namespace', { path })} active={tree.consolePinned} busy={tree.busy} toggle={tree.toggleConsole} />
            </span>}
        </div>
        {open && <ul>{node.children.map(child => <TreeNodeView key={child.path} node={child} tree={tree} />)}{!fixed && <NamespacePlaceholder parent={path} busy={tree.busy} create={tree.create} drop={tree.drop} pick={tree.pick} />}</ul>}
    </li>;
}

/** @brief Render concrete node behavior through the tree renderer interface. */
function TreeNodeView({ node, tree }: { node: TreeNode; tree: TreeProps }) {
    return node.render({ command: command => <CommandNode node={command} tree={tree} />, namespace: namespace => <NamespaceNode node={namespace} tree={tree} /> });
}

/** @brief React registry editor with versioned drafts and conversation-based organization. */
export function ManagementPanel({ api, ProfileSelect, organize }: ManagementPanelProps) {
    const t = useTranslation();
    const Select = ProfileSelect ?? PortableProfileSelect;
    const [view, setView] = useState<View>();
    const [mappings, setMappings] = useState<Mapping[]>([]);
    const [namespaces, setNamespaces] = useState<Namespace[]>([]);
    const [order, setOrder] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [builtinDisabled, setBuiltinDisabled] = useState<string[]>([]);
    const [consolePinned, setConsolePinned] = useState(false);
    const [builtinVisible, setBuiltinVisible] = useState<CommandVisibility>({ ...pluginCommands.defaultBuiltinVisible });
    const [unmountedVisible, setUnmountedVisible] = useState<CommandVisibility>({});
    const [toolComments, setToolComments] = useState<Record<string, string>>({});
    const [descriptionEditor, setDescriptionEditor] = useState<{ id: string; text?: string }>();
    const [toolPicker, setToolPicker] = useState<{ parent: string; unmountedOnly?: boolean }>();
    const [status, setStatus] = useState('loading');
    const [busy, setBusy] = useState(false);

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal, profile: string | null = view?.state.profiles?.includes(view.state.profile!) ? view.state.profile! : null): Promise<void> {
        const url = new URL(api, document.baseURI);
        if (profile) url.searchParams.set('profile', profile);
        applyView(await request<View>(url.href, undefined, signal));
    }

    /** @brief Load an editor snapshot without changing the catalog default. */
    function applyView(snapshot: View): void {
        setView(snapshot); setMappings(structuredClone(snapshot.state.mappings));
        setNamespaces(structuredClone(snapshot.state.namespaces ?? []));
        setUnmountedVisible(structuredClone(snapshot.state.unmountedVisible ?? {}));
        setBuiltinVisible(structuredClone(snapshot.state.builtinVisible ?? pluginCommands.defaultBuiltinVisible));
        setConsolePinned(snapshot.state.consolePinned ?? false);
        setBuiltinDisabled(snapshot.state.builtinDisabled ?? []);
        setToolComments(structuredClone(snapshot.state.toolComments ?? {}));
        setOrder(orderedPaths([...namespacePaths({ mappings: snapshot.state.mappings, namespaces: snapshot.state.namespaces ?? [] }), ...snapshot.state.mappings.flatMap(m => [m.path, ...m.aliases])], snapshot.state.order ?? []));
        setStatus('');
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setBuiltinDisabled([]); setConsolePinned(false); setMappings([]); setNamespaces([]); setUnmountedVisible({}); setToolComments({}); setOrder([]); setExpanded({}); setDescriptionEditor(undefined); setToolPicker(undefined); setStatus('loading');
        void reload(controller.signal, null).catch(error => { if (!controller.signal.aborted) setStatus(String(error instanceof Error ? error.message : error)); });
        return () => controller.abort();
    }, [api]);

    /** @brief Report failed actions without losing unsaved mapping edits. */
    async function action(message: string, task: () => Promise<void>): Promise<void> {
        setBusy(true); setStatus(message);
        try { await task(); }
        catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    }

    const provided = TreeProvider(builtinVisible, (view?.tools.find(tool => tool.id === 'tools_search')?.parameters.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum ?? []);
    const namespaceTree = new NamespaceTree({ mappings, namespaces, order }, provided, view?.tools ?? []);
    const unmounted = unmountedTools(view?.tools ?? [], mappings);
    const paths = [...new Set([...provided.map(node => node.path), ...namespacePaths({ mappings, namespaces })])];
    const saved = view?.state;
    const draft = profileDraft({ mappings, namespaces, unmountedVisible, builtinVisible, builtinDisabled, consolePinned, toolComments, order });
    const newProfile = !!saved && !saved.profiles?.includes(saved.profile!);
    const dirty = !!saved && (newProfile || JSON.stringify(draft) !== JSON.stringify(profileDraft(saved)));

    /** @brief Change the default while preserving the editor's selection and draft. */
    function selectDefault(name: string): void {
        if (!view || name === view.defaultProfile) return;
        void action('', async () => {
            await request(api, { action: 'profile', operation: 'select', name, revision: view.state.revision });
            const url = new URL(api, document.baseURI);
            if (!newProfile) url.searchParams.set('profile', view.state.profile!);
            const snapshot = await request<View>(url.href);
            setView({ ...view, defaultProfile: snapshot.defaultProfile, state: { ...view.state, revision: snapshot.state.revision, profiles: snapshot.state.profiles } });
        });
    }

    /** @brief Create a local empty profile; persistence occurs only when saving. */
    function createProfile(name: string): void {
        if (!view) return;
        applyView({ ...view, state: { ...view.state, profile: name, mappings: [], namespaces: [], order: [], unmountedVisible: {}, builtinDisabled: [], builtinVisible: { ...pluginCommands.defaultBuiltinVisible }, consolePinned: false, toolComments: {} } });
        setExpanded({}); setToolPicker(undefined); setDescriptionEditor(undefined);
    }

    /** @brief Manage catalog names without using editor selection to change the default. */
    function manageProfile(operation: 'select' | 'rename' | 'delete', name: string, newName?: string): void {
        if (!view) return;
        if (operation === 'select') {
            if (name !== view.state.profile) void action('', () => reload(undefined, name));
            return;
        }
        if (newProfile && name === view.state.profile) {
            if (operation === 'rename') setView({ ...view, state: { ...view.state, profile: newName! } });
            else void action('', () => reload(undefined, view.defaultProfile));
            return;
        }
        void action('', async () => {
            await request(api, { action: 'profile', operation, name, newName, revision: view.state.revision });
            setToolPicker(undefined); setDescriptionEditor(undefined); setExpanded({});
            const selected = view.state.profile === name ? (operation === 'rename' ? newName : null) : view.state.profile;
            await reload(undefined, selected);
        });
    }

    /** @brief Keep inferred and explicitly created namespaces in the same draft metadata model. */
    function configureNamespace(path: string, patch: Partial<Namespace>): void {
        if (isFixedNamespace(path)) return;
        setNamespaces(current => {
            const next = { path, alwaysVisible: false, description: '', ...current.find(n => n.path === path), ...patch };
            return current.some(n => n.path === path) ? current.map(n => n.path === path ? next : n) : [...current, next];
        });
    }

    /** @brief Commit only named namespaces that do not conflict with callable paths. */
    function createNamespace(path: string): boolean {
        if (isFixedNamespace(path)) { setStatus('fixed_namespace'); return false; }
        const toolPaths = mappings.flatMap(m => [m.path, ...m.aliases]);
        if (!/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(path) || paths.includes(path) ||
            toolPaths.some(p => p === path || path.startsWith(`${p}.`))) {
            setStatus('invalid_namespace'); return false;
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
            setStatus('invalid_mapping'); return false;
        }
        replacePath(source, path); setStatus('');
        return true;
    }

    /** @brief Remove a single mapping, promoting another mapped path when one remains. */
    function removeMapping(path: string): void {
        const mapping = mappings.find(m => m.path === path || m.aliases.includes(path));
        if (busy || !mapping || mapping.pinned) return;
        const parent = path.split('.').slice(0, -1).join('.');
        if (parent) configureNamespace(parent, {});
        const remaining = [mapping.path, ...mapping.aliases].filter(p => p !== path);
        if (!remaining.length && mapping.alwaysVisible) setUnmountedVisible(current => ({ ...current, [mapping.id]: mapping.alwaysVisible! }));
        setMappings(current => current.flatMap(m => m.id !== mapping.id ? [m] : remaining.length ? [{ ...m, path: remaining[0]!, aliases: remaining.slice(1) }] : []));
        setStatus('');
    }

    /** @brief Apply subtree edits atomically to the local draft and retain disclosure state across renames. */
    function editNamespace(source: string, name?: string): boolean {
        if (busy || !view) return false;
        try {
            const draft = { mappings, namespaces, order };
            const next = name === undefined ? deleteNamespace(draft, source) : renameNamespace(draft, source, name);
            const lostPins = mappings.filter(mapping => mapping.alwaysVisible && !next.mappings.some(next => next.id === mapping.id)).map(mapping => [mapping.id, mapping.alwaysVisible!] as const);
            if (lostPins.length) setUnmountedVisible(current => ({ ...current, ...Object.fromEntries(lostPins) }));
            setMappings(next.mappings); setNamespaces(next.namespaces); setOrder(next.order);
            if (name !== undefined) {
                const target = [...source.split('.').slice(0, -1), name].join('.');
                setExpanded(current => Object.fromEntries(Object.entries(current).map(([path, open]) => [inNamespace(path, source) ? target + path.slice(source.length) : path, open])));
            } else setExpanded(current => Object.fromEntries(Object.entries(current).filter(([path]) => !inNamespace(path, source))));
            setStatus(''); return true;
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return false; }
    }

    /** @brief Commit one atomic drag operation for commands, namespaces and physical tool blocks. */
    function applyDrop(source: TreeDragSource, target: TreeDropTarget): void {
        if (busy || !view) return;
        try {
            if (!source.namespace && !view.tools.some(tool => tool.id === source.id)) return;
            const name = view.effective.find(m => m.id === source.id)?.path.split('.').at(-1) || source.id?.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(?=\d)/, '_');
            const next = dropTree({ mappings, namespaces, order }, source, target, name);
            for (const mapping of next.mappings) if (!mappings.some(current => current.id === mapping.id) && unmountedVisible[mapping.id]) mapping.alwaysVisible = unmountedVisible[mapping.id];
            setUnmountedVisible(current => Object.fromEntries(Object.entries(current).filter(([id]) => !next.mappings.some(mapping => mapping.id === id))));
            if (source.namespace && source.path) {
                const parent = target.position === 'inside' ? target.path : target.path.split('.').slice(0, -1).join('.');
                const destination = [parent, source.path.split('.').at(-1)].filter(Boolean).join('.');
                setExpanded(current => Object.fromEntries(Object.entries(current).map(([path, open]) => [inNamespace(path, source.path!) ? destination + path.slice(source.path!.length) : path, open])));
            }
            setMappings(next.mappings); setNamespaces(next.namespaces); setOrder(next.order);
            setStatus('');
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }

    /** @brief Keep HTML drag compatibility while using the same center/edge resolution as pointer dragging. */
    function nativeDrop(event: DragEvent<HTMLElement>, target: TreeDropTarget): void {
        event.preventDefault(); event.stopPropagation(); clearTreeDropFeedback();
        if (event.currentTarget.dataset.dropDisabled === 'true') return;
        const namespace = event.dataTransfer.getData('application/x-ts-namespace');
        applyDrop({ namespace: !!namespace, path: namespace || event.dataTransfer.getData('application/x-ts-mapping') || undefined, id: event.dataTransfer.getData('application/x-ts-tool') || undefined }, target);
    }
    const drag = useTreeDrag(applyDrop);

    const tree: TreeProps = {
        disabled: path => path !== 'tools.intellisense' && (builtinDisabled.some(prefix => inNamespace(path, prefix))
            || namespaces.some(node => node.disabled && inNamespace(path, node.path))
            || mappings.some(mapping => mapping.disabled && [mapping.path, ...mapping.aliases].includes(path))),
        toggleDisabled: path => {
            if (busy || path === 'tools.intellisense') return;
            if (path.startsWith('tools.') || path === 'tools' || path === 'console' || path.startsWith('console.')) {
                setBuiltinDisabled(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]);
            } else {
                const mapping = mappings.find(item => [item.path, ...item.aliases].includes(path));
                if (mapping) setMappings(current => current.map(item => item.id === mapping.id ? { ...item, disabled: !item.disabled } : item));
                else configureNamespace(path, { disabled: !namespaces.find(node => node.path === path)?.disabled });
            }
        },
        consolePinned, toggleConsole: () => setConsolePinned(current => !current),
        expanded, tools: view?.tools ?? [], busy: busy || !view,
        pinBuiltin: path => setBuiltinVisible(current => ({ ...current, [path]: path === 'tools.intellisense' ? 2 : nextPinLevel(current[path] ?? 0) })),
        toolComments, unmountedVisible, pinUnmounted: id => setUnmountedVisible(current => ({ ...current, [id]: nextPinLevel(current[id] ?? 0) })),
        editDescription: id => { if (!busy) setDescriptionEditor({ id, text: Object.hasOwn(toolComments, id) ? toolComments[id] : mappings.find(m => m.id === id)?.description }); },
        pick: parent => setToolPicker({ parent }), configure: configureNamespace, drop: (event, parent) => nativeDrop(event, { path: parent, position: 'inside' }), create: createNamespace, rename: renameMapping, remove: removeMapping,
        pinTool: mapping => setMappings(current => current.map(m => m.id === mapping.id ? { ...m, alwaysVisible: nextPinLevel(m.alwaysVisible ?? 0) } : m)),
        renameNamespace: (path, name) => editNamespace(path, name), deleteNamespace: path => { editNamespace(path); },
        toggle: path => setExpanded(current => ({ ...current, [path]: !(current[path] ?? false) })), dropNode: (event) => nativeDrop(event, treeDropTarget(event.currentTarget, event.clientY)),
    };

    return <div className="ts-intellisense" ref={drag.container} onPointerDownCapture={drag.pointerDown} onDragStartCapture={drag.preventNativeDrag}>
        <style>{styles}</style>
        <header><h1>{t('title')}</h1></header>
        {status && (['loading', 'updating_profile', 'organizing'].includes(status)
            ? <p role="status" aria-live="polite">{t(status)}</p>
            : <ErrorDialog message={t(status)} close={() => setStatus('')} />)}
        <div className="ts-toolbar"><div className="ts-actions">
            <div className="ts-default-profile"><span>{t('profile')}</span>
                <Select value={view?.defaultProfile ?? 'Default'} options={(view?.state.profiles ?? ['Default']).map(name => ({ value: name, label: name }))}
                    disabled={busy || !view} readOnly allowCreate={false} onChange={selectDefault}
                    onCreate={createProfile} onRename={(name, newName) => manageProfile('rename', name, newName)} onRemove={name => manageProfile('delete', name)} />
            </div>
            <button className="ts-organize" disabled={busy || !organize} onClick={() => void action('organizing', async () => {
                await organize!(t('organization_prompt')); setStatus('');
            })}>{t('generate_proposal')}</button>
        </div></div>
        <main><section className="ts-namespaces"><div className="ts-namespace-heading"><h2>{t('namespace_tree')}</h2>
            <div className="ts-namespace-profile">
                <ProfilePicker name={view?.state.profile ?? 'Default'} profiles={[...(view?.state.profiles ?? ['Default']), ...(newProfile ? [view!.state.profile!] : [])]}
                    dirty={dirty} busy={busy || !view} Select={ProfileSelect} protectedProfile={view?.state.profiles?.length === 1 ? view.state.profiles[0] : undefined}
                    refresh={() => void action('', reload)} refreshDisabled={busy}
                    select={name => manageProfile('select', name)} create={createProfile}
                    rename={(name, newName) => manageProfile('rename', name, newName)} remove={name => manageProfile('delete', name)}
                    save={profile => void action('', async () => {
                        const copyName = profile ?? (newProfile ? view!.state.profile : undefined);
                        await request(api, { action: copyName === undefined ? 'configure' : 'save_as',
                            ...(copyName === undefined ? {} : { profile: copyName }), activate: false,
                            ...(newProfile ? {} : { editingProfile: view!.state.profile }), revision: view!.state.revision, ...draft });
                        await reload(undefined, copyName ?? view!.state.profile);
                    })} />
            </div>
        </div>
            <small>{t('tree_hint')}</small>
            {view && <button className="ts-unmounted-count" type="button" data-unmounted-count={unmounted.length} aria-live="polite" disabled={busy || !unmounted.length}
                onClick={() => setToolPicker({ parent: '', unmountedOnly: true })}>{t('unmounted_count', { count: unmounted.length })}</button>}
            <ul className="ts-tree">{namespaceTree.roots.map(node => <TreeNodeView key={node.path} node={node} tree={tree} />)}
                <NamespacePlaceholder busy={busy || !view} create={createNamespace} pick={parent => setToolPicker({ parent })} drop={(event, parent) => nativeDrop(event, { path: parent, position: 'inside' })} />
            </ul>
        </section></main>
        {toolPicker !== undefined && view && <ToolPicker parent={toolPicker.parent} tools={toolPicker.unmountedOnly ? unmounted : view.tools} mappings={mappings} busy={busy}
            close={() => setToolPicker(undefined)} select={tool => {
                applyDrop({ namespace: false, id: tool.id }, { path: toolPicker.parent, position: 'inside' });
                setToolPicker(undefined);
            }} />}
        {descriptionEditor && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-description-title">
            <form onSubmit={event => {
                event.preventDefault();
                setToolComments(current => {
                    const next = { ...current };
                    if (descriptionEditor.text === undefined) delete next[descriptionEditor.id];
                    else next[descriptionEditor.id] = descriptionEditor.text;
                    return next;
                });
                setMappings(current => current.map(mapping => {
                    if (mapping.id !== descriptionEditor.id) return mapping;
                    const { description: _description, ...rest } = mapping;
                    return rest;
                }));
                setDescriptionEditor(undefined); setStatus('');
            }}>
                <h2 id="ts-description-title">{t('prompt_comment')} · {descriptionEditor.id}</h2>
                <textarea aria-label={t('prompt_comment')} autoFocus rows={8} value={descriptionEditor.text ?? view?.tools.find(t => t.id === descriptionEditor.id)?.description ?? ''}
                    onChange={event => setDescriptionEditor({ ...descriptionEditor, text: event.target.value })} />
                <div className="ts-actions"><button type="submit">{t('apply')}</button>
                    <button type="button" onClick={() => setDescriptionEditor({ id: descriptionEditor.id })}>{t('reset')}</button>
                    <button type="button" onClick={() => setDescriptionEditor(undefined)}>{t('cancel')}</button></div>
            </form>
        </section></div>}
    </div>;
}

