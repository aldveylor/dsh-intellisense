import { NamespaceSection } from './namespace_section/namespace_section.js';
import type { TreeProps } from './tree_view/tree_props.js';
import { UsageDialog } from '../documentation/usage_dialog.js';
import { UsageButton } from '../documentation/usage_button.js';
import { ActionButton } from '../controls/action_button.js';
import { useTranslation } from '../locale/locale.js';
import styles from './management_panel.css';
import { ErrorDialog } from './error_dialog.js';
import { useLayoutMotion } from '../animation/layout_motion.js';
import { NamespaceTree, type TreeNode } from './tree_node.js';
import { useEffect, useMemo, useRef, useState, type ComponentType, type DragEvent } from 'react';
import type { Namespace, Mapping, PhysicalTool, RegistryStateData as RegistryState, PinLevel, CommandVisibility, RegistryConfigurationData as RegistryConfiguration } from '../../registry/registry.js';
import { nextFixLevel, type SerializedNode } from '../../namespace/node.js';
import { validateNodePath as validatePath } from '../../namespace/node.js';
import { TreeProvider, unmountedTools, providedNamespace, providedTools } from './tree_provider.js';
import { ProfileSelect as PortableProfileSelect, type ProfileSelectProps } from '../profile_picker/profile_picker.js';
import { parseProfileJson } from '../profile_picker/profile_json.js';
import { TooltipProvider } from '../tooltip/tooltip.js';
import { ToolPicker } from '../tool_picker/tool_picker.js';
import { useTreeDrag, treeDropTarget, clearTreeDropFeedback } from './tree_drag.js';
import { isFixedNamespace, namespacePaths, orderedPaths, inNamespace, renameNamespace, deleteNamespace, dropTree, type TreeDragSource, type TreeDropTarget } from './namespace_tree.js';

/** @brief Authenticated management metadata, shared by embedded and standalone React views. */
interface View {
    provided: SerializedNode[];
    defaultProfile: string;
    profileBriefs?: Record<string, string>;
    state: RegistryState;
    tools: PhysicalTool[];
    callsByTool?: Record<string, number>;
    queriesByTool?: Record<string, number>;
    namespaceQueriesByPath?: Record<string, number>;
    effective: Array<Mapping & { tool: PhysicalTool }>;
}

/** @brief Shared editor inputs; the mounting surface supplies its authenticated API URL. */
export interface ManagementPanelProps { api: string; ProfileSelect?: ComponentType<ProfileSelectProps>; DefaultProfileSelect?: ComponentType<ProfileSelectProps>; organize?: (prompt: string) => Promise<void> }

/** @brief Make an authenticated same-origin request and preserve server error details. */
async function request<T>(api: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(api, {
        credentials: 'same-origin', signal,
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'http_request_failed');
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
        ...(state.brief === undefined ? {} : { brief: state.brief }), mappings, namespaces, unmountedVisible: state.unmountedVisible ?? {}, builtinVisible: state.builtinVisible ?? {},
        builtinDisabled: state.builtinDisabled ?? [], namespaceVisible: state.namespaceVisible ?? {}, toolComments: state.toolComments ?? {},
        order: orderedPaths([...new Set(paths)], (state.order ?? []).map(path => path.trim())),
    };
}

/** @brief Cycle command prompt exposure from hidden to brief to detailed. */
function nextPinLevel(level: PinLevel): PinLevel { return ((level + 1) % 3) as PinLevel; }

/** @brief Retain unchanged snapshot fields so metadata updates do not rebuild the tree. */
function retain<T>(current: T, next: T): T { return JSON.stringify(current) === JSON.stringify(next) ? current : next; }

/** @brief React registry editor with versioned drafts and conversation-based organization. */
export function ManagementPanel({ api, ProfileSelect, DefaultProfileSelect, organize }: ManagementPanelProps) {
    const t = useTranslation();
    const [showUsage, setShowUsage] = useState(false);
    const Select = DefaultProfileSelect ?? PortableProfileSelect;
    const [view, setView] = useState<View>();
    const [brief, setBrief] = useState<string>();
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
            queriesByTool: retain(current.queriesByTool, snapshot.queriesByTool), namespaceQueriesByPath: retain(current.namespaceQueriesByPath, snapshot.namespaceQueriesByPath),
        } : snapshot);
        applyDraft(snapshot.state, snapshot.provided);
        setStatus('');
    }

    /** @brief Apply local edits without replacing the server snapshot used for dirty detection. */
    function applyDraft(state: Pick<RegistryState, keyof RegistryConfiguration>, nodes = view?.provided ?? []): void {
        setBrief(state.brief);
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
    const saved = useMemo(() => view ? profileDraft(view.state, view.provided) : undefined, [view?.state.brief, view?.state.mappings, view?.state.namespaces, view?.state.order, view?.state.unmountedVisible, view?.state.builtinVisible, view?.state.builtinDisabled, view?.state.namespaceVisible, view?.state.toolComments, view?.provided]);
    const draft = useMemo(() => profileDraft({ brief, mappings, namespaces, unmountedVisible, builtinVisible, builtinDisabled, namespaceVisible, toolComments, order }, view?.provided),
        [brief, mappings, namespaces, unmountedVisible, builtinVisible, builtinDisabled, namespaceVisible, toolComments, order, view?.provided]);
    const newProfile = !!view && !view.state.profiles?.includes(view.state.profile!);
    const dirty = useMemo(() => !!saved && (newProfile || JSON.stringify(draft) !== JSON.stringify(saved)), [saved, draft, newProfile]);

    /** @brief Download the selected Profile, including its unsaved editor changes. */
    async function downloadProfile(): Promise<void> {
        if (!view) return;
        await action('', async () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            const filename = Array.from(view.state.profile ?? t('profile_download_name'), char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('');
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
            const snapshot = await request<{ defaultProfile: string; revision: number; profiles: string[]; profileBriefs?: Record<string, string> }>(api,
                { action: 'profile', operation: 'select', name, revision: view.state.revision });
            setView(current => current && ({ ...current, defaultProfile: snapshot.defaultProfile, profileBriefs: snapshot.profileBriefs, state: { ...current.state, revision: snapshot.revision, profiles: retain(current.state.profiles, snapshot.profiles) } }));
        }, 'default');
    }

    /** @brief Create a local empty profile; persistence occurs only when saving. */
    function createProfile(name: string): void {
        if (!view) return;
        applyView({ ...view, state: { ...view.state, profile: name, brief: undefined, mappings: [], namespaces: [], order: [], unmountedVisible: {}, builtinDisabled: [], builtinVisible: {}, namespaceVisible: {}, toolComments: {} } });
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
        try { validatePath(`${path}.namespace_check`); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return false; }
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
        try { validatePath(path); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return false; }
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
        element => element.classList.contains('ts-namespace-placeholder') ? `${element.dataset.namespacePath}.__placeholder__` : element.dataset.namespacePath ?? element.dataset.treePath!, expanded);

    /** @brief Lock descendant disable controls while preserving their own configured state. */
    function disabledByAncestor(path: string): boolean {
        return builtinDisabled.some(prefix => prefix !== path && inNamespace(path, prefix))
            || namespaces.some(node => node.disabled && node.path !== path && inNamespace(path, node.path));
    }

    const tree = useMemo<TreeProps>(() => ({
        disabledByAncestor,
        disabled: path => !!namespaceTree.root.resolve(path.split('.'))?.permissions.disableable && (builtinDisabled.some(prefix => inNamespace(path, prefix))
            || namespaces.some(node => node.disabled && inNamespace(path, node.path))
            || mappings.some(mapping => mapping.disabled && mapping.path === path)),
        toggleDisabled: path => {
            const node = namespaceTree.root.resolve(path.split('.'));
            if (busyRef.current || !node?.permissions.disableable || disabledByAncestor(path)) return;
            if (providedNamespace(path, provided)) {
                setBuiltinDisabled(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]);
            } else {
                const mapping = mappings.find(item => item.path === path);
                if (mapping) setMappings(current => current.map(item => item.path === path ? { ...item, disabled: !item.disabled } : item));
                else configureNamespace(path, { disabled: !namespaces.find(node => node.path === path)?.disabled });
            }
        },
        namespaceVisible, toggleProvidedNamespace: path => setNamespaceVisible(current => ({ ...current, [path]: !current[path] })),
        expanded, toolsById, callsByTool: view?.callsByTool ?? {}, queriesByTool: view?.queriesByTool ?? {}, namespaceQueriesByPath: view?.namespaceQueriesByPath ?? {}, busy: !view,
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
    }), [namespaceTree, mappings, namespaces, order, paths, provided, expanded, namespaceVisible, builtinDisabled, toolComments, unmountedVisible, toolsById, view?.tools, view?.callsByTool, view?.queriesByTool, view?.namespaceQueriesByPath, view?.effective]);

    const inspectWarning = useMemo(() => {
        let inspectAvailable = false;
        let incompletePins = false;
        const visit = (node: TreeNode): void => {
            if (tree.disabled(node.path)) return;
            node.render({
                command: command => {
                    if (command.path === 'tools.inspect') inspectAvailable = toolsById.has(command.command?.id ?? '');
                    else if (command.level !== 2) incompletePins = true;
                },
                namespace: namespace => namespace.children.forEach(visit),
            });
        };
        namespaceTree.roots.forEach(visit);
        return !inspectAvailable && incompletePins;
    }, [namespaceTree, tree, toolsById]);

    return <div className="ts-intellisense" ref={drag.container} onPointerDownCapture={drag.pointerDown} onDragStartCapture={drag.preventNativeDrag}>
        <style>{styles}</style><TooltipProvider>
        {!view && <div className="ts-load-overlay" aria-busy={status === 'loading'}>
            {status === 'loading' ? <p role="status" aria-live="polite">{t('loading')}</p>
                : <><p className="ts-error-message" role="alert">{t(status)}</p>
                    <div className="ts-dialog-actions">
                        <ActionButton type="button" title={t('retry_load_hint')} disabled={busy} onClick={() => void action('loading', () => reload(undefined, null))}>{t('refresh')}</ActionButton>
                        <ActionButton type="button" disabled={busy} title={t('reset_failed_data')} onClick={() => void action('loading', async () => {
                            await request(api, { action: 'recover' });
                            await reload(undefined, null);
                        })}>{t('reset')}</ActionButton>
                    </div></>}
        </div>}
        <div className="ts-panel-content" ref={element => { if (element) element.inert = !view; }}>
            <header className="ts-panel-header"><h1>{t('title')}</h1><UsageButton open={() => setShowUsage(true)} /></header>
            {showUsage && <UsageDialog api={api} close={() => setShowUsage(false)} />}
            {view && status && (['loading', 'updating_profile', 'organizing'].includes(status)
                ? <p role="status" aria-live="polite">{t(status)}</p>
                : <ErrorDialog message={t(status)} close={() => setStatus('')} />)}
            <div className="ts-toolbar"><div className="ts-actions">
                <div className="ts-default-profile" aria-busy={pending === 'default' || undefined} ref={element => { if (element) element.inert = pending === 'default'; }}><span>{t('default_profile')}</span>
                    <div className="ts-default-profile-control"><Select value={view?.defaultProfile ?? ''} options={(view?.state.profiles ?? []).map(name => ({ value: name, label: name, brief: view?.profileBriefs?.[name] }))}
                        disabled={!view} label={t('default_profile')} hint={t('default_profile_hint')} readOnly allowCreate={false} onChange={selectDefault}
                        onCreate={createProfile} onRename={(name, newName) => manageProfile('rename', name, newName)} onRemove={name => manageProfile('delete', name)} /></div>
                </div>
                <ActionButton className="ts-organize" title={t('generate_proposal_hint')} disabled={pending === 'organize' || !organize} onClick={() => void action('organizing', async () => {
                    await organize!(t('organization_prompt')); setStatus('');
                }, 'organize')}>{t('generate_proposal')}</ActionButton>
            </div></div>
            <main><NamespaceSection loaded={!!view} busy={busy} editorPending={pending === 'editor'}
                roots={namespaceTree.roots} tree={tree} inspectWarning={inspectWarning} unmountedCount={unmounted.length} brief={brief}
                pickTools={unmountedOnly => setToolPicker({ parent: '', unmountedOnly })} editBrief={value => setBrief(value || undefined)}
                profile={{
                    name: view?.state.profile ?? '',
                    profiles: [...(view?.state.profiles ?? []), ...(newProfile ? [view!.state.profile!] : [])],
                    download: downloadProfile,
                    upload: uploadProfile,
                    briefs: { ...view?.profileBriefs, ...(view ? { [view.state.profile!]: brief ?? '' } : {}) },
                    dirty,
                    busy: !view,
                    Select: ProfileSelect,
                    protectedProfile: view?.state.profiles?.length === 1 ? view.state.profiles[0] : undefined,
                    refresh: () => action('', reload),
                    refreshDisabled: !view,
                    select: name => manageProfile('select', name),
                    create: createProfile,
                    rename: (name, newName) => manageProfile('rename', name, newName),
                    remove: name => manageProfile('delete', name),
                    save: profile => action('', async () => {
                        const copyName = profile ?? (newProfile ? view!.state.profile : undefined);
                        await request(api, { action: copyName === undefined ? 'configure' : 'save_as',
                            ...(copyName === undefined ? {} : { profile: copyName }), activate: false,
                            ...(newProfile ? {} : { editingProfile: view!.state.profile }), revision: view!.state.revision, ...draft });
                        await reload(undefined, copyName ?? view!.state.profile);
                    }),
                }} /></main>
        </div>
        {toolPicker !== undefined && view && <ToolPicker parent={toolPicker.parent} tools={view.tools} unmountedOnly={toolPicker.unmountedOnly} mappings={mappings} protectedTools={providedTools(provided, view.tools)} callsByTool={view.callsByTool} queriesByTool={view.queriesByTool} busy={busy}
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
                <div className="ts-dialog-actions"><ActionButton variant="primary" type="submit" title={t('apply_draft_hint')}>{t('apply')}</ActionButton>
                    <ActionButton type="button" title={t('reset_comment_hint')} onClick={() => setDescriptionEditor({ id: descriptionEditor.id, path: descriptionEditor.path })}>{t('reset')}</ActionButton>
                    <ActionButton type="button" title={t('cancel_hint')} onClick={() => setDescriptionEditor(undefined)}>{t('cancel')}</ActionButton></div>
            </form>
        </section></div>}
    </TooltipProvider></div>;
}

