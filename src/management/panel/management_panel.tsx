import { useTranslation } from '../locale/locale.js';
import styles from './management_panel.css';
import { ErrorDialog } from './error_dialog.js';
import { useLayoutMotion } from '../animation/layout_motion.js';
import { NamespaceTree, type TreeNode, type CommandTreeNode, type NamespaceTreeNode } from './tree_node.js';
import { memo, useEffect, useMemo, useRef, useState, type ComponentType, type DragEvent, type ReactNode } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryState, PinLevel, CommandVisibility, RegistryConfiguration } from '../../registry/registry.js';
import { nextFixLevel, type SerializedNode } from '../../namespace/node.js';
import { validateNodePath as validatePath } from '../../namespace/node.js';
import { TreeProvider, unmountedTools, providedNamespace, providedTools } from './tree_provider.js';
import { ProfilePicker, ProfileSelect as PortableProfileSelect, type ProfileSelectProps } from '../profile_picker/profile_picker.js';
import { parseProfileJson } from '../profile_picker/profile_json.js';
import { TooltipProvider } from '../tooltip/tooltip.js';
import { CommandDetails, NamespaceDetails, useTreeTooltip } from '../tooltip/tree_details.js';
import { ToolPicker } from '../tool_picker/tool_picker.js';
import { useTreeDrag, treeDropTarget, showTreeDropFeedback, clearTreeDropFeedback } from './tree_drag.js';
import { isFixedNamespace, namespacePaths, orderedPaths, inNamespace, renameNamespace, deleteNamespace, dropTree, type TreeDragSource, type TreeDropTarget } from './namespace_tree.js';

/** @brief Authenticated management metadata, shared by embedded and standalone React views. */
interface View {
    provided: SerializedNode[];
    defaultProfile: string;
    state: RegistryState;
    tools: PhysicalTool[];
    callsByTool?: Record<string, number>;
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
function profileDraft(state: Pick<RegistryState, keyof RegistryConfiguration>, provided: readonly SerializedNode[] = []): RegistryConfiguration {
    const mappings = state.mappings.map(({ id, path, description, pinned, disabled, alwaysVisible }) => ({
        id, path: path.trim(), description, pinned, disabled, alwaysVisible,
    }));
    const namespaces = state.namespaces ?? [];
    const paths = [...TreeProvider(provided, state.builtinVisible ?? {}).map(node => node.path), ...namespacePaths({ mappings, namespaces }), ...mappings.map(mapping => mapping.path)];
    return {
        mappings, namespaces, unmountedVisible: state.unmountedVisible ?? {}, builtinVisible: state.builtinVisible ?? {},
        builtinDisabled: state.builtinDisabled ?? [], namespaceVisible: state.namespaceVisible ?? {}, toolComments: state.toolComments ?? {},
        order: orderedPaths([...new Set(paths)], (state.order ?? []).map(path => path.trim())),
    };
}

/** @brief A double-click text editor that keeps its draft local until explicit commit or blur. */
function EditableText({ value, label, className, busy, empty = false, commit }: {
    value: string; label: string; className: string; busy: boolean; empty?: boolean; commit: (value: string) => boolean;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();
    return draft === undefined ? <span className={className} aria-label={label} role="button" tabIndex={busy ? -1 : 0}
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8" /><g className="ts-disable-mark"><path d="M6 12h12" /><path className="ts-disable-cross" d="M12 6v12" /></g></svg>
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

/** @brief Retain an insertion slot while a native drag enters another row or the slot itself. */
function leaveTreeDrag(event: DragEvent<HTMLElement>): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.closest('.ts-tree')?.contains(event.relatedTarget)) return;
    clearTreeDropFeedback();
}

/** @brief Render commands with shared fixed, read-only and movement policies supplied by their data source. */
function CommandNode({ node, tree }: { node: CommandTreeNode; tree: TreeProps }) {
    const t = useTranslation();
    const { path, mapping, command, fixed, description } = node;
    const id = mapping?.id ?? command?.id;
    const contract = node.serialize().command;
    const tool = (id ? tree.toolsById.get(id) : undefined) ?? {
        id: id ?? contract?.tool ?? path, description: description ?? '', parameters: contract?.schema ?? {}, output: contract?.output,
    };
    const summary = mapping?.description ?? (id && Object.hasOwn(tree.toolComments, id) ? tree.toolComments[id] : undefined) ?? '';
    const tooltip = useTreeTooltip(<CommandDetails path={path} tool={tool} summary={summary} calls={tree.callsByTool[tool.id] ?? 0} />);
    const readOnly = !node.permissions.renamable;
    const invalid = !!mapping && !(id && tree.toolsById.has(id));
    const draggable = !tree.busy && node.draggable;
    const disableButton = node.permissions.disableable ? <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} /> : null;
    const pinButton = <PinButton label={t('pin_command', { path })} active={!!node.level} level={node.level} busy={tree.busy || !!command?.disabled}
        locked={node.permissions.availableFixLevels.length <= 1}
        toggle={() => { if (command) tree.pinBuiltin(path); else if (mapping) tree.pinTool(mapping); else if (id) tree.pinUnmounted(id); }} />;
    return <li className={`ts-tree-tool${fixed ? ' ts-fixed-node' : ''}${invalid ? ' ts-tool-invalid' : ''}`}
        aria-disabled={tree.disabled(path) || undefined} data-tool-status={tree.disabled(path) ? 'disabled' : invalid ? 'invalid' : 'available'} data-tree-path={path} data-tool-id={id} data-drop-disabled={readOnly || undefined}
        {...tooltip} draggable={draggable}
        onDragStart={event => {
            if (!draggable || (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-tool', id!);
            event.dataTransfer.setData('application/x-ts-mapping', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || readOnly)}
        onDragLeave={leaveTreeDrag}
        onDrop={event => { if (readOnly) { event.preventDefault(); event.stopPropagation(); } else tree.dropNode(event, path, false); }}>
        {readOnly ? <code>{path.split('.').at(-1)}</code> :
            <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('mapping_name', { path })} busy={tree.busy || !!mapping?.pinned}
                commit={name => tree.rename(path, name)} />}
        {id && <span className="ts-mapping-source"><span aria-hidden="true">→ </span>{id}{invalid && <span role="status"> · {t('unavailable')}</span>}</span>}
        <span className="ts-tool-preview" role={fixed ? undefined : 'button'} tabIndex={fixed ? undefined : tree.busy ? -1 : 0}
            onDoubleClick={() => { if (!fixed && id) tree.editDescription(path); }} onKeyDown={event => {
                if (!fixed && id && event.key === 'Enter') { event.preventDefault(); tree.editDescription(path); }
            }}>{mapping?.description ?? (id && Object.hasOwn(tree.toolComments, id) ? tree.toolComments[id] : undefined) ?? description ?? t('edit_comment')}</span>
        <span className="ts-node-actions">
            {command && disableButton}
            {pinButton}
            {!command && disableButton}
            {node.permissions.removable && <RemoveButton label={t('remove_mapping', { path })} busy={tree.busy || !!mapping?.pinned} remove={() => tree.remove(path)} />}
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
    toolsById: ReadonlyMap<string, PhysicalTool>; callsByTool: Record<string, number>; busy: boolean;
    expanded: Record<string, boolean>;
    configure: (path: string, patch: Partial<Namespace>) => void;
    drop: (event: DragEvent<HTMLElement>, parent: string) => void;
    pick: (parent: string) => void; create: (path: string) => boolean; rename: (path: string, name: string) => boolean;
    editDescription: (path: string) => void; remove: (path: string) => void; pinTool: (mapping: Mapping) => void;
    renameNamespace: (path: string, name: string) => boolean; deleteNamespace: (path: string) => void;
    toggle: (path: string) => void; dropNode: (event: DragEvent<HTMLElement>, path: string, namespace: boolean) => void;
    namespaceVisible: Record<string, boolean>; toggleProvidedNamespace: (path: string) => void;
    pinBuiltin: (path: string) => void; toolComments: Record<string, string>; unmountedVisible: CommandVisibility; pinUnmounted: (id: string) => void;
}

/** @brief Keep closing children mounted until their disclosure animation has completed. */
function TreeChildren({ open, children }: { open: boolean; children: ReactNode }) {
    const [present, setPresent] = useState(open);
    useEffect(() => { if (open) setPresent(true); }, [open]);
    if (!open && !present) return null;
    return <div className="ts-tree-children" data-open={open} aria-hidden={!open}
        ref={element => { if (element) element.inert = !open; }} onAnimationEnd={event => {
            if (event.target === event.currentTarget && !open) setPresent(false);
        }}><ul>{children}</ul></div>;
}

/** @brief Namespace row whose children toggle only through the leading disclosure button. */
function NamespaceNode({ node, tree }: { node: NamespaceTreeNode; tree: TreeProps }) {
    const t = useTranslation();
    const { path, fixed, metadata: config, count } = node;
    const open = tree.expanded[path] ?? false;
    const tooltip = useTreeTooltip(<NamespaceDetails path={path} description={node.description} />);
    return <li data-tree-path={path} data-disabled={tree.disabled(path) || undefined}>
        <div {...tooltip} className={`ts-node-block${fixed ? ' ts-fixed-node' : ''}`} data-namespace-path={path} data-drop-disabled={!node.permissions.acceptsChildren || undefined} draggable={!tree.busy && node.permissions.movable} onDragStart={event => {
            if (!node.permissions.movable) { event.preventDefault(); return; }
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-namespace', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || !node.permissions.acceptsChildren)} onDragLeave={leaveTreeDrag} onDrop={event => tree.dropNode(event, path, true)}>
            <button className="ts-disclosure" type="button" aria-label={t('toggle_namespace', { path })} aria-expanded={open} disabled={tree.busy}
                onClick={() => tree.toggle(path)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
            {!node.permissions.renamable ? <span className="ts-node-name">{path.split('.').at(-1)}</span> : <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('namespace_path_name', { path })} busy={tree.busy}
                commit={name => tree.renameNamespace(path, name)} />}
            <small className="ts-node-count" aria-label={t('command_count', { path })}>{count}</small>
            {fixed ? <span className="ts-node-preview">{node.description}</span> : <><EditableText className="ts-node-preview" value={config?.description ?? ''} label={t('namespace_comment', { path })} busy={tree.busy} empty
                commit={description => { tree.configure(path, { description }); return true; }} />
            <span className="ts-node-actions">
                <PinButton label={t('pin_namespace', { path })} active={config?.alwaysVisible ?? false} busy={tree.busy}
                    toggle={() => tree.configure(path, { alwaysVisible: !config?.alwaysVisible })} />
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />}
                {node.permissions.removable && <RemoveButton label={t('delete_namespace', { path })} busy={tree.busy} remove={() => tree.deleteNamespace(path)} />}
            </span></>}
            {node.pinMode === 'locked' && <span className="ts-node-actions">
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />}
                <PinButton label={t('fixed_namespace')} tooltip={t('fixed_namespace')} active busy={tree.busy} locked toggle={() => {}} />
            </span>}
            {node.pinMode === 'provided' && <span className="ts-node-actions">
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy} toggle={() => tree.toggleDisabled(path)} />}
                <PinButton label={t('pin_namespace', { path })} active={tree.namespaceVisible[path] ?? false} busy={tree.busy} toggle={() => tree.toggleProvidedNamespace(path)} />
            </span>}
        </div>
        <TreeChildren open={open}>{node.children.map(child => <TreeNodeView key={child.path} node={child} tree={tree} />)}{node.permissions.acceptsChildren && <NamespacePlaceholder parent={path} busy={tree.busy} create={tree.create} drop={tree.drop} pick={tree.pick} />}</TreeChildren>
    </li>;
}

/** @brief Render concrete node behavior through the tree renderer interface. */
function TreeNodeView({ node, tree }: { node: TreeNode; tree: TreeProps }) {
    return node.render({ command: command => <CommandNode node={command} tree={tree} />, namespace: namespace => <NamespaceNode node={namespace} tree={tree} /> });
}

/** @brief Retain unchanged snapshot fields so metadata updates do not rebuild the tree. */
function retain<T>(current: T, next: T): T { return JSON.stringify(current) === JSON.stringify(next) ? current : next; }

/** @brief Render tree rows independently from Profile requests and dialog state. */
const NamespaceTreeView = memo(function NamespaceTreeView({ roots, tree }: { roots: TreeNode[]; tree: TreeProps }) {
    return <TooltipProvider><ul className="ts-tree">{roots.map(node => <TreeNodeView key={node.path} node={node} tree={tree} />)}
        <NamespacePlaceholder busy={tree.busy} create={tree.create} pick={tree.pick} drop={tree.drop} />
    </ul></TooltipProvider>;
});

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
    const [namespaceVisible, setNamespaceVisible] = useState<Record<string, boolean>>({});
    const [builtinVisible, setBuiltinVisible] = useState<CommandVisibility>({});
    const [unmountedVisible, setUnmountedVisible] = useState<CommandVisibility>({});
    const [toolComments, setToolComments] = useState<Record<string, string>>({});
    const [descriptionEditor, setDescriptionEditor] = useState<{ id: string; path: string; text?: string }>();
    const [toolPicker, setToolPicker] = useState<{ parent: string; unmountedOnly?: boolean }>();
    const [status, setStatus] = useState('loading');
    const [pending, setPending] = useState<'editor' | 'default' | 'organize'>();
    const busy = pending !== undefined;
    const busyRef = useRef(false);

    /** @brief Replace drafts only after a successful snapshot load. */
    async function reload(signal?: AbortSignal, profile: string | null = view?.state.profiles?.includes(view.state.profile!) ? view.state.profile! : null): Promise<void> {
        const url = new URL(api, document.baseURI);
        if (profile) url.searchParams.set('profile', profile);
        applyView(await request<View>(url.href, undefined, signal));
    }

    /** @brief Load an editor snapshot without changing the catalog default. */
    function applyView(snapshot: View): void {
        setView(current => current ? { ...snapshot,
            tools: retain(current.tools, snapshot.tools), provided: retain(current.provided, snapshot.provided),
            effective: retain(current.effective, snapshot.effective), callsByTool: retain(current.callsByTool, snapshot.callsByTool),
        } : snapshot);
        applyDraft(snapshot.state, snapshot.provided);
        setStatus('');
    }

    /** @brief Apply local edits without replacing the server snapshot used for dirty detection. */
    function applyDraft(state: Pick<RegistryState, keyof RegistryConfiguration>, nodes = view?.provided ?? []): void {
        setMappings(current => retain(current, state.mappings));
        setNamespaces(current => retain(current, state.namespaces ?? []));
        setUnmountedVisible(current => retain(current, state.unmountedVisible ?? {}));
        setBuiltinVisible(current => retain(current, state.builtinVisible ?? {}));
        setNamespaceVisible(current => retain(current, state.namespaceVisible ?? {}));
        setBuiltinDisabled(current => retain(current, state.builtinDisabled ?? []));
        setToolComments(current => retain(current, state.toolComments ?? {}));
        setOrder(current => retain(current, profileDraft(state, nodes).order));
    }

    useEffect(() => {
        const controller = new AbortController();
        setView(undefined); setBuiltinDisabled([]); setNamespaceVisible({}); setMappings([]); setNamespaces([]); setUnmountedVisible({}); setToolComments({}); setOrder([]); setExpanded({}); setDescriptionEditor(undefined); setToolPicker(undefined); setStatus('loading');
        void reload(controller.signal, null).catch(error => { if (!controller.signal.aborted) setStatus(String(error instanceof Error ? error.message : error)); });
        return () => controller.abort();
    }, [api]);

    /** @brief Report failed actions without losing unsaved mapping edits. */
    async function action(message: string, task: () => Promise<void>, scope: 'editor' | 'default' | 'organize' = 'editor'): Promise<void> {
        if (busyRef.current) return;
        busyRef.current = true;
        setPending(scope); setStatus(message);
        try { await task(); }
        catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
        finally { busyRef.current = false; setPending(undefined); }
    }

    const provided = useMemo(() => TreeProvider(view?.provided ?? [], builtinVisible), [view?.provided, builtinVisible]);
    const namespaceTree = useMemo(() => new NamespaceTree({ mappings, namespaces, order }, provided, view?.tools ?? []), [mappings, namespaces, order, provided, view?.tools]);
    const unmounted = useMemo(() => unmountedTools(view?.tools ?? [], mappings, provided), [view?.tools, mappings, provided]);
    const toolsById = useMemo(() => new Map(view?.tools.map(tool => [tool.id, tool])), [view?.tools]);
    const paths = useMemo(() => [...new Set([...provided.map(node => node.path), ...namespacePaths({ mappings, namespaces })])], [provided, mappings, namespaces]);
    const saved = useMemo(() => view ? profileDraft(view.state, view.provided) : undefined, [view?.state.mappings, view?.state.namespaces, view?.state.order, view?.state.unmountedVisible, view?.state.builtinVisible, view?.state.builtinDisabled, view?.state.namespaceVisible, view?.state.toolComments, view?.provided]);
    const draft = useMemo(() => profileDraft({ mappings, namespaces, unmountedVisible, builtinVisible, builtinDisabled, namespaceVisible, toolComments, order }, view?.provided),
        [mappings, namespaces, unmountedVisible, builtinVisible, builtinDisabled, namespaceVisible, toolComments, order, view?.provided]);
    const newProfile = !!view && !view.state.profiles?.includes(view.state.profile!);
    const dirty = useMemo(() => !!saved && (newProfile || JSON.stringify(draft) !== JSON.stringify(saved)), [saved, draft, newProfile]);

    /** @brief Download the selected Profile, including its unsaved editor changes. */
    async function downloadProfile(): Promise<void> {
        if (!view) return;
        await action('', async () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            const filename = Array.from(view.state.profile ?? 'Profile', char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('');
            link.download = `${filename}.json`;
            document.body.append(link);
            try { link.click(); }
            finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        });
    }

    /** @brief Import validated JSON into the selected draft; Save persists it explicitly. */
    async function uploadProfile(file: File): Promise<void> {
        if (!view) return;
        await action('', async () => {
            let configuration: RegistryConfiguration;
            try { configuration = parseProfileJson(await file.text()); }
            catch { throw new Error(t('invalid_profile_json')); }
            applyDraft(configuration);
            setStatus('');
            setToolPicker(undefined); setDescriptionEditor(undefined);
        });
    }

    /** @brief Change the default while preserving the editor's selection and draft. */
    function selectDefault(name: string): void {
        if (!view || name === view.defaultProfile) return;
        void action('', async () => {
            const snapshot = await request<{ defaultProfile: string; revision: number; profiles: string[] }>(api,
                { action: 'profile', operation: 'select', name, revision: view.state.revision });
            setView(current => current && ({ ...current, defaultProfile: snapshot.defaultProfile, state: { ...current.state, revision: snapshot.revision, profiles: retain(current.state.profiles, snapshot.profiles) } }));
        }, 'default');
    }

    /** @brief Create a local empty profile; persistence occurs only when saving. */
    function createProfile(name: string): void {
        if (!view) return;
        applyView({ ...view, state: { ...view.state, profile: name, mappings: [], namespaces: [], order: [], unmountedVisible: {}, builtinDisabled: [], builtinVisible: {}, namespaceVisible: {}, toolComments: {} } });
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
            setToolPicker(undefined); setDescriptionEditor(undefined);
            const selected = view.state.profile === name ? (operation === 'rename' ? newName : null) : view.state.profile;
            await reload(undefined, selected);
        });
    }

    /** @brief Keep inferred and explicitly created namespaces in the same draft metadata model. */
    function configureNamespace(path: string, patch: Partial<Namespace>): void {
        if (isFixedNamespace(path, provided)) return;
        setNamespaces(current => {
            const next = { path, alwaysVisible: false, description: '', ...current.find(n => n.path === path), ...patch };
            return current.some(n => n.path === path) ? current.map(n => n.path === path ? next : n) : [...current, next];
        });
    }

    /** @brief Commit only named namespaces that do not conflict with callable paths. */
    function createNamespace(path: string): boolean {
        if (isFixedNamespace(path, provided)) { setStatus('fixed_namespace'); return false; }
        const toolPaths = mappings.map(m => m.path);
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
        return paths.includes(path) || mappings.map(m => m.path).filter(p => p !== source)
            .some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`));
    }

    /** @brief Replace one mapped path while keeping the tool's physical identity intact. */
    function replacePath(source: string, path: string): void {
        setOrder(current => current.map(p => p === source ? path : p));
        setMappings(current => current.map(m => ({ ...m,
            path: m.path === source ? path : m.path,
        })));
    }

    /** @brief Rename only the mapped identifier, never the underlying physical tool. */
    function renameMapping(source: string, name: string): boolean {
        const mapping = mappings.find(m => m.path === source);
        if (busyRef.current || !mapping || mapping.pinned) return false;
        const path = [...source.split('.').slice(0, -1), name].join('.');
        try { validatePath(path); } catch (error) { setStatus(String(error)); return false; }
        if (!/^[a-zA-Z_$][\w$]*$/.test(name) || ['__proto__', 'prototype', 'constructor', 'then'].includes(name) || name.startsWith('__dsh') || occupied(path, source)) {
            setStatus('invalid_mapping'); return false;
        }
        replacePath(source, path); setStatus('');
        return true;
    }

    /** @brief Remove one mounting path while preserving all other mounts. */
    function removeMapping(path: string): void {
        const mapping = mappings.find(m => m.path === path);
        const node = namespaceTree.root.resolve(path.split('.'));
        if (busyRef.current || !mapping || mapping.pinned || !node?.permissions.removable) return;
        const parent = path.split('.').slice(0, -1).join('.');
        if (parent) configureNamespace(parent, {});
        if (!mappings.some(item => item.id === mapping.id && item.path !== path) && mapping.alwaysVisible) setUnmountedVisible(current => ({ ...current, [mapping.id]: mapping.alwaysVisible! }));
        setMappings(current => current.filter(item => item.path !== path));
        setStatus('');
    }

    /** @brief Apply subtree edits atomically to the local draft and retain disclosure state across renames. */
    function editNamespace(source: string, name?: string): boolean {
        if (busyRef.current || !view) return false;
        try {
            const node = namespaceTree.root.resolve(source.split('.'));
            if (!node || (name === undefined ? !node.permissions.removable : !node.permissions.renamable)) throw new Error('fixed_namespace');
            const draft = { mappings, namespaces, order, provided };
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
        if (busyRef.current || !view) return;
        try {
            if (!source.namespace && !view.tools.some(tool => tool.id === source.id)) return;
            const name = view.effective.find(m => m.id === source.id)?.path.split('.').at(-1) || source.id?.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^(?=\d)/, '_');
            const next = dropTree({ mappings, namespaces, order, provided }, source, target, name);
            for (const mapping of next.mappings) if (!mappings.some(current => current.id === mapping.id) && unmountedVisible[mapping.id]) mapping.alwaysVisible = unmountedVisible[mapping.id];
            setUnmountedVisible(current => Object.fromEntries(Object.entries(current).filter(([id]) => !next.mappings.some(mapping => mapping.id === id))));
            if (source.namespace && source.path) {
                const parent = target.position === 'inside' ? target.path : target.path.split('.').slice(0, -1).join('.');
                const destination = [parent, source.path.split('.').at(-1)].filter(Boolean).join('.');
                setExpanded(current => Object.fromEntries(Object.entries(current).map(([path, open]) => [inNamespace(path, source.path!) ? destination + path.slice(source.path!.length) : path, open])));
            }
            if (source.path) {
                const parent = target.position === 'inside' ? target.path : target.path.split('.').slice(0, -1).join('.');
                const destination = source.namespace ? [parent, source.path.split('.').at(-1)].filter(Boolean).join('.')
                    : next.mappings[mappings.findIndex(mapping => mapping.path === source.path && mapping.id === source.id)]?.path;
                if (destination) remapMotion(source.path, destination);
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
    const remapMotion = useLayoutMotion(drag.container, '.ts-tree .ts-node-block,.ts-tree .ts-tree-tool,.ts-tree .ts-namespace-placeholder',
        element => element.classList.contains('ts-namespace-placeholder') ? `${element.dataset.namespacePath}.__placeholder__` : element.dataset.namespacePath ?? element.dataset.treePath!);

    const tree = useMemo<TreeProps>(() => ({
        disabled: path => !!namespaceTree.root.resolve(path.split('.'))?.permissions.disableable && (builtinDisabled.some(prefix => inNamespace(path, prefix))
            || namespaces.some(node => node.disabled && inNamespace(path, node.path))
            || mappings.some(mapping => mapping.disabled && mapping.path === path)),
        toggleDisabled: path => {
            const node = namespaceTree.root.resolve(path.split('.'));
            if (busyRef.current || !node?.permissions.disableable) return;
            if (providedNamespace(path, provided)) {
                setBuiltinDisabled(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]);
            } else {
                const mapping = mappings.find(item => item.path === path);
                if (mapping) setMappings(current => current.map(item => item.path === path ? { ...item, disabled: !item.disabled } : item));
                else configureNamespace(path, { disabled: !namespaces.find(node => node.path === path)?.disabled });
            }
        },
        namespaceVisible, toggleProvidedNamespace: path => setNamespaceVisible(current => ({ ...current, [path]: !current[path] })),
        expanded, toolsById, callsByTool: view?.callsByTool ?? {}, busy: !view,
        pinBuiltin: path => {
            const node = namespaceTree.root.resolve(path.split('.'));
            if (busyRef.current || !node || node.permissions.availableFixLevels.length <= 1) return;
            setBuiltinVisible(current => ({ ...current, [path]: nextFixLevel(node.permissions, current[path] ?? 0) }));
        },
        toolComments, unmountedVisible, pinUnmounted: id => setUnmountedVisible(current => ({ ...current, [id]: nextPinLevel(current[id] ?? 0) })),
        editDescription: path => {
            const mapping = mappings.find(item => item.path === path);
            if (!busyRef.current && mapping) setDescriptionEditor({ id: mapping.id, path, text: mapping.description ?? toolComments[mapping.id] });
        },
        pick: parent => setToolPicker({ parent }), configure: configureNamespace, drop: (event, parent) => nativeDrop(event, { path: parent, position: 'inside' }), create: createNamespace, rename: renameMapping, remove: removeMapping,
        pinTool: mapping => setMappings(current => current.map(m => m.path === mapping.path ? { ...m, alwaysVisible: nextPinLevel(m.alwaysVisible ?? 0) } : m)),
        renameNamespace: (path, name) => editNamespace(path, name), deleteNamespace: path => { editNamespace(path); },
        toggle: path => setExpanded(current => ({ ...current, [path]: !(current[path] ?? false) })), dropNode: (event) => nativeDrop(event, treeDropTarget(event.currentTarget, event.clientY)),
    }), [namespaceTree, mappings, namespaces, order, paths, provided, expanded, namespaceVisible, builtinDisabled, toolComments, unmountedVisible, toolsById, view?.tools, view?.callsByTool, view?.effective]);

    return <div className="ts-intellisense" ref={drag.container} onPointerDownCapture={drag.pointerDown} onDragStartCapture={drag.preventNativeDrag}>
        <style>{styles}</style>
        {!view && <div className="ts-load-overlay" aria-busy={status === 'loading'}>
            {status === 'loading' ? <p role="status" aria-live="polite">{t('loading')}</p>
                : <button type="button" title={t(status)} onClick={() => void action('loading', () => reload(undefined, null))}>{t('retry')}</button>}
        </div>}
        <div className="ts-panel-content" ref={element => { if (element) element.inert = !view; }}>
            <header><h1>{t('title')}</h1></header>
            {view && status && (['loading', 'updating_profile', 'organizing'].includes(status)
                ? <p role="status" aria-live="polite">{t(status)}</p>
                : <ErrorDialog message={t(status)} close={() => setStatus('')} />)}
            <div className="ts-toolbar"><div className="ts-actions">
                <div className="ts-default-profile" aria-busy={pending === 'default' || undefined} ref={element => { if (element) element.inert = pending === 'default'; }}><span>{t('default_profile')}</span>
                    <Select value={view?.defaultProfile ?? ''} options={(view?.state.profiles ?? []).map(name => ({ value: name, label: name }))}
                        disabled={!view} label={t('default_profile')} readOnly allowCreate={false} onChange={selectDefault}
                        onCreate={createProfile} onRename={(name, newName) => manageProfile('rename', name, newName)} onRemove={name => manageProfile('delete', name)} />
                </div>
                <button className="ts-organize" disabled={pending === 'organize' || !organize} onClick={() => void action('organizing', async () => {
                    await organize!(t('organization_prompt')); setStatus('');
                }, 'organize')}>{t('generate_proposal')}</button>
            </div></div>
            <main><section className="ts-namespaces"><div className="ts-namespace-heading"><h2>{t('namespace_tree')}</h2>
                <button className="ts-add-tool ts-open-tools" type="button" aria-label={t('add_tools')} title={t('add_tools')} disabled={!view}
                    onClick={() => setToolPicker({ parent: '' })}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="M14 6a5 5 0 0 0-6-4l3 3-3 3-3-3a5 5 0 0 0 6 6l8 8a2 2 0 0 0 3-3z" />
                    </svg>
                </button>
                <div className="ts-namespace-profile" aria-busy={pending === 'editor' || undefined} ref={element => { if (element) element.inert = pending === 'editor'; }}>
                    <ProfilePicker name={view?.state.profile ?? ''} profiles={[...(view?.state.profiles ?? []), ...(newProfile ? [view!.state.profile!] : [])]}
                        download={downloadProfile} upload={uploadProfile}
                        dirty={dirty} busy={!view} Select={ProfileSelect} protectedProfile={view?.state.profiles?.length === 1 ? view.state.profiles[0] : undefined}
                        refresh={() => action('', reload)} refreshDisabled={!view}
                        select={name => manageProfile('select', name)} create={createProfile}
                        rename={(name, newName) => manageProfile('rename', name, newName)} remove={name => manageProfile('delete', name)}
                        save={profile => action('', async () => {
                            const copyName = profile ?? (newProfile ? view!.state.profile : undefined);
                            await request(api, { action: copyName === undefined ? 'configure' : 'save_as',
                                ...(copyName === undefined ? {} : { profile: copyName }), activate: false,
                                ...(newProfile ? {} : { editingProfile: view!.state.profile }), revision: view!.state.revision, ...draft });
                            await reload(undefined, copyName ?? view!.state.profile);
                        })} />
                </div>
            </div>
                <small>{t('tree_hint')}</small>
                {view && <button className="ts-unmounted-count" type="button" data-unmounted-count={unmounted.length} aria-live="polite" disabled={!unmounted.length}
                    onClick={() => setToolPicker({ parent: '', unmountedOnly: true })}>{t('unmounted_count', { count: unmounted.length })}</button>}
                <div aria-busy={pending === 'editor' || undefined} ref={element => { if (element) element.inert = pending === 'editor'; }}>
                    <NamespaceTreeView roots={namespaceTree.roots} tree={tree} />
                </div>
            </section></main>
        </div>
        {toolPicker !== undefined && view && <ToolPicker parent={toolPicker.parent} tools={toolPicker.unmountedOnly ? unmounted : view.tools} mappings={mappings} protectedTools={providedTools(provided, view.tools)} callsByTool={view.callsByTool} busy={busy}
            close={() => setToolPicker(undefined)} select={tool => {
                applyDrop({ namespace: false, id: tool.id }, { path: toolPicker.parent, position: 'inside' });
                setToolPicker(undefined);
            }} />}
        {descriptionEditor && <div className="ts-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ts-description-title">
            <form onSubmit={event => {
                event.preventDefault();
                setMappings(current => current.map(mapping => mapping.path === descriptionEditor.path
                    ? { ...mapping, description: descriptionEditor.text } : mapping));
                setDescriptionEditor(undefined); setStatus('');
            }}>
                <h2 id="ts-description-title">{t('prompt_comment')} · {descriptionEditor.path}</h2>
                <textarea aria-label={t('prompt_comment')} autoFocus rows={8} value={descriptionEditor.text ?? view?.tools.find(t => t.id === descriptionEditor.id)?.description ?? ''}
                    onChange={event => setDescriptionEditor({ ...descriptionEditor, text: event.target.value })} />
                <div className="ts-actions"><button type="submit">{t('apply')}</button>
                    <button type="button" onClick={() => setDescriptionEditor({ id: descriptionEditor.id, path: descriptionEditor.path })}>{t('reset')}</button>
                    <button type="button" onClick={() => setDescriptionEditor(undefined)}>{t('cancel')}</button></div>
            </form>
        </section></div>}
    </div>;
}

