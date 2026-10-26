import { providedNamespace, type ProvidedNamespace } from './tree_provider.js';
import { validateNodePath as validatePath } from '../../namespace/node.js';
import type { Mapping, Namespace } from '../../registry/registry.js';

/** @brief The editable tree configuration independent of physical tool identities. */
export interface TreeDraft { mappings: Mapping[]; namespaces: Namespace[]; order: string[]; provided?: readonly ProvidedNamespace[] }

/** @brief Fixed namespaces are display-only and cannot receive configurable tree nodes. */
export function isFixedNamespace(path: string, provided: readonly ProvidedNamespace[] = []): boolean {
    const permissions = providedNamespace(path, provided)?.permissions;
    return !!permissions && !permissions.renamable && !permissions.movable && !permissions.removable;
}

/** @brief List explicit and inferred namespace paths. */
export function namespacePaths(draft: Pick<TreeDraft, 'mappings' | 'namespaces'>): string[] {
    return [...new Set([
        ...draft.namespaces.map(n => n.path),
        ...draft.mappings.map(m => m.path.split('.').slice(0, -1).join('.')),
    ].flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))).filter(Boolean))];
}

/** @brief Match a namespace and its complete subtree without matching similarly named siblings. */
export function inNamespace(path: string, namespace: string): boolean { return path === namespace || path.startsWith(`${namespace}.`); }

/** @brief Preserve mixed namespace/command ordering, appending newly created nodes. */
export function orderedPaths(paths: string[], order: string[]): string[] {
    const rank = new Map([...new Set([...order, ...paths])].map((path, i) => [path, i]));
    return [...paths].sort((a, b) => rank.get(a)! - rank.get(b)!);
}

/** @brief Rename one namespace, migrating descendants, command paths, metadata and display order together. */
export function renameNamespace(draft: TreeDraft, source: string, name: string): TreeDraft {
    if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new Error('invalid_namespace_name');
    const target = [...source.split('.').slice(0, -1), name].join('.');
    return relocateNamespace(draft, source, target);
}

/** @brief Move a complete namespace subtree to an explicitly resolved destination. */
function relocateNamespace(draft: TreeDraft, source: string, target: string): TreeDraft {
    if (isFixedNamespace(source, draft.provided) || isFixedNamespace(target, draft.provided)) throw new Error('fixed_namespace');
    validatePath(`${target}.namespace_check`);
    if (target !== source && inNamespace(target, source)) throw new Error('namespace_cycle');
    if (source === target) return draft;
    const paths = namespacePaths(draft);
    if (!paths.includes(source)) throw new Error('missing_namespace');
    if (paths.some(path => !inNamespace(path, source) && inNamespace(path, target))) throw new Error('namespace_name_conflict');
    if (draft.mappings.some(m => m.pinned && inNamespace(m.path, source))) throw new Error('locked_namespace_mapping');
    const move = (path: string): string => inNamespace(path, source) ? target + path.slice(source.length) : path;
    const mappings = draft.mappings.map(m => ({ ...m, path: move(m.path) }));
    const namespaces = draft.namespaces.map(n => ({ ...n, path: move(n.path) }));
    if (!namespaces.some(n => n.path === target)) namespaces.push({ path: target, alwaysVisible: false, description: '' });
    for (const path of mappings.map(m => m.path)) {
        if (namespaces.some(n => inNamespace(n.path, path))) throw new Error('namespace_command_conflict');
    }
    return { ...draft, mappings, namespaces, order: draft.order.map(move) };
}

/** @brief Delete a subtree's namespace metadata and mappings, keeping physical tools and outside mappings. */
export function deleteNamespace(draft: TreeDraft, source: string): TreeDraft {
    if (isFixedNamespace(source, draft.provided)) throw new Error('fixed_namespace');
    if (draft.mappings.some(m => m.pinned && inNamespace(m.path, source))) throw new Error('locked_namespace_mapping');
    return {
        ...draft, namespaces: draft.namespaces.filter(n => !inNamespace(n.path, source)),
        mappings: draft.mappings.filter(m => !inNamespace(m.path, source)),
        order: draft.order.filter(path => !inNamespace(path, source)),
    };
}

/** @brief Reorder sibling commands and namespaces without changing their semantic paths. */
export function reorderTree(draft: TreeDraft, source: string, target: string, after: boolean): string[] {
    const parent = (path: string): string => path.split('.').slice(0, -1).join('.');
    if (isFixedNamespace(source, draft.provided) || isFixedNamespace(parent(target), draft.provided)) throw new Error('fixed_namespace');
    const paths = [...namespacePaths(draft), ...draft.mappings.map(m => m.path)];
    if (source === target || parent(source) !== parent(target) || !paths.includes(source) || !paths.includes(target)) return draft.order;
    const order = orderedPaths(paths, draft.order).filter(path => path !== source);
    order.splice(order.indexOf(target) + Number(after), 0, source);
    return order;
}

/** @brief Source identity for both native and pointer-driven tree dragging. */
export interface TreeDragSource { namespace: boolean; path?: string; id?: string }
/** @brief A concrete insertion boundary or namespace interior. */
export interface TreeDropTarget { path: string; position: 'inside' | 'before' | 'after' }

/** @brief Move or mount any tree node atomically, including cross-namespace insertion beside commands. */
export function dropTree(draft: TreeDraft, source: TreeDragSource, target: TreeDropTarget, defaultName = 'command'): TreeDraft {
    const parent = target.position === 'inside' ? target.path : target.path.split('.').slice(0, -1).join('.');
    if (isFixedNamespace(parent, draft.provided)) throw new Error('fixed_drop_target');
    if ((source.namespace && source.path && isFixedNamespace(source.path)) || (source.path && providedNamespace(source.path, draft.provided)?.commands.some(command => command.path === source.path && !command.permissions.movable))) throw new Error('fixed_move_source');
    const namespaces = namespacePaths(draft);
    if (parent && !namespaces.includes(parent)) throw new Error('missing_drop_namespace');
    if (target.position !== 'inside' && ![...namespaces, ...draft.mappings.map(m => m.path)].includes(target.path)) throw new Error('missing_drop_node');
    const mapping = source.path ? draft.mappings.find(m => m.id === source.id && m.path === source.path) : undefined;
    const previous = !mapping && source.path && providedNamespace(source.path, draft.provided) ? undefined : source.path || (source.namespace ? undefined : mapping?.path);
    if (!source.namespace && mapping?.pinned) throw new Error('locked_mapping');
    if (previous === target.path && target.position !== 'inside') return draft;
    if (source.namespace && (!previous || !namespaces.includes(previous))) throw new Error('missing_source_namespace');
    if (source.namespace && previous && (parent === previous || inNamespace(parent, previous))) throw new Error('namespace_cycle');
    if (!source.namespace && (!source.id || (previous && previous !== mapping?.path))) throw new Error('missing_source_mapping');
    const name = previous?.split('.').at(-1) || source.path?.split('.').at(-1) || defaultName;
    const prefix = parent ? `${parent}.` : '';
    let path = `${prefix}${name}`;
    const occupied = (path: string): boolean => [...namespaces, ...draft.mappings.map(m => m.path)]
        .filter(p => source.namespace && previous ? !inNamespace(p, previous) : p !== previous)
        .some(p => p === path || p.startsWith(`${path}.`) || (!namespaces.includes(p) && path.startsWith(`${p}.`)));
    if (!source.namespace) for (let suffix = 2; occupied(path); suffix++) path = `${prefix}${name}_${suffix}`;
    validatePath(source.namespace ? `${path}.namespace_check` : path);
    let next: TreeDraft;
    if (source.namespace) { const moved = relocateNamespace(draft, previous!, path); next = { ...moved, namespaces: [...moved.namespaces] }; }
    else {
        const entry: Mapping = { id: source.id!, pinned: false, ...mapping, path };
        next = { ...draft, mappings: mapping ? draft.mappings.map(m => m.path === previous ? entry : m) : [...draft.mappings, entry], namespaces: [...draft.namespaces] };
    }
    const oldParent = previous?.split('.').slice(0, -1).join('.');
    for (const keep of [parent, oldParent]) if (keep && !isFixedNamespace(keep, draft.provided) && !next.namespaces.some(n => n.path === keep)) next.namespaces.push({ path: keep, alwaysVisible: false, description: '' });
    const move = (p: string): string => previous && (source.namespace ? inNamespace(p, previous) : p === previous) ? path + p.slice(previous.length) : p;
    const all = orderedPaths([...namespacePaths(next), ...next.mappings.map(m => m.path)], draft.order.map(move));
    const moving = all.filter(p => source.namespace ? inNamespace(p, path) : p === path);
    const rest = all.filter(p => !moving.includes(p));
    const index = target.position === 'inside' ? rest.length : rest.indexOf(target.path) + Number(target.position === 'after');
    rest.splice(index < 0 ? rest.length : index, 0, ...moving);
    return { ...next, order: rest };
}
