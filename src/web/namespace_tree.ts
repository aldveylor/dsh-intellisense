import { validatePath } from '../registry/path.js';
import type { Mapping, Namespace } from '../registry/registry.js';

/** @brief The editable tree configuration independent of physical tool identities. */
export interface TreeDraft { mappings: Mapping[]; namespaces: Namespace[]; order: string[] }

/** @brief List explicit and inferred namespace paths. */
export function namespacePaths(draft: Pick<TreeDraft, 'mappings' | 'namespaces'>): string[] {
    return [...new Set([
        ...draft.namespaces.map(n => n.path),
        ...draft.mappings.flatMap(m => [m.path, ...m.aliases].map(path => path.split('.').slice(0, -1).join('.'))),
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
    if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new Error('命名空间名称无效。');
    const target = [...source.split('.').slice(0, -1), name].join('.');
    return relocateNamespace(draft, source, target);
}

/** @brief Move a complete namespace subtree to an explicitly resolved destination. */
function relocateNamespace(draft: TreeDraft, source: string, target: string): TreeDraft {
    validatePath(`${target}.namespace_check`);
    if (target !== source && inNamespace(target, source)) throw new Error('不能拖入自身或子命名空间。');
    if (target === 'unknown') throw new Error('unknown 是保留命名空间。');
    if (source === target) return draft;
    const paths = namespacePaths(draft);
    if (!paths.includes(source)) throw new Error('命名空间不存在。');
    if (paths.some(path => !inNamespace(path, source) && inNamespace(path, target))) throw new Error('命名空间名称冲突。');
    if (draft.mappings.some(m => m.pinned && [m.path, ...m.aliases].some(p => inNamespace(p, source)))) throw new Error('命名空间包含锁定映射。');
    const move = (path: string): string => inNamespace(path, source) ? target + path.slice(source.length) : path;
    const mappings = draft.mappings.map(m => ({ ...m, path: move(m.path), aliases: m.aliases.map(move) }));
    const namespaces = draft.namespaces.map(n => ({ ...n, path: move(n.path) }));
    if (!namespaces.some(n => n.path === target)) namespaces.push({ path: target, alwaysVisible: false, description: '' });
    for (const path of mappings.flatMap(m => [m.path, ...m.aliases])) {
        if (namespaces.some(n => inNamespace(n.path, path))) throw new Error('命名空间与命令路径冲突。');
    }
    return { mappings, namespaces, order: draft.order.map(move) };
}

/** @brief Delete a subtree's namespace metadata and mappings, keeping physical tools and outside mappings. */
export function deleteNamespace(draft: TreeDraft, source: string): TreeDraft {
    if (draft.mappings.some(m => m.pinned && [m.path, ...m.aliases].some(p => inNamespace(p, source)))) throw new Error('命名空间包含锁定映射。');
    return {
        namespaces: draft.namespaces.filter(n => !inNamespace(n.path, source)),
        mappings: draft.mappings.flatMap(m => {
            const paths = [m.path, ...m.aliases].filter(path => !inNamespace(path, source));
            return paths.length ? [{ ...m, path: paths[0]!, aliases: paths.slice(1) }] : [];
        }),
        order: draft.order.filter(path => !inNamespace(path, source)),
    };
}

/** @brief Reorder sibling commands and namespaces without changing their semantic paths. */
export function reorderTree(draft: TreeDraft, source: string, target: string, after: boolean): string[] {
    const parent = (path: string): string => path.split('.').slice(0, -1).join('.');
    const paths = [...namespacePaths(draft), ...draft.mappings.flatMap(m => [m.path, ...m.aliases])];
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
    const namespaces = namespacePaths(draft);
    if (parent && !namespaces.includes(parent)) throw new Error('目标命名空间不存在。');
    if (target.position !== 'inside' && ![...namespaces, ...draft.mappings.flatMap(m => [m.path, ...m.aliases])].includes(target.path)) throw new Error('目标节点不存在。');
    const mapping = draft.mappings.find(m => m.id === source.id);
    const previous = source.path || (source.namespace ? undefined : mapping?.path);
    if (!source.namespace && mapping?.pinned) throw new Error('映射路径已锁定。');
    if (previous === target.path && target.position !== 'inside') return draft;
    if (source.namespace && (!previous || !namespaces.includes(previous))) throw new Error('源命名空间不存在。');
    if (source.namespace && previous && (parent === previous || inNamespace(parent, previous))) throw new Error('不能拖入自身或子命名空间。');
    if (!source.namespace && (!source.id || (source.path && !mapping?.aliases.includes(source.path) && source.path !== mapping?.path))) throw new Error('源工具映射不存在。');
    const name = previous?.split('.').at(-1) || defaultName;
    const prefix = parent ? `${parent}.` : '';
    let path = `${prefix}${name}`;
    const occupied = (path: string): boolean => [...namespaces, ...draft.mappings.flatMap(m => [m.path, ...m.aliases])]
        .filter(p => source.namespace && previous ? !inNamespace(p, previous) : p !== previous)
        .some(p => p === path || p.startsWith(`${path}.`) || (!namespaces.includes(p) && path.startsWith(`${p}.`)));
    if (!source.namespace) for (let suffix = 2; occupied(path); suffix++) path = `${prefix}${name}_${suffix}`;
    validatePath(source.namespace ? `${path}.namespace_check` : path);
    let next: TreeDraft;
    if (source.namespace) { const moved = relocateNamespace(draft, previous!, path); next = { ...moved, namespaces: [...moved.namespaces] }; }
    else {
        const entry: Mapping = { id: source.id!, path, aliases: [], enabled: true, pinned: false, ...mapping };
        if (previous && mapping?.path !== previous) entry.aliases = entry.aliases.map(p => p === previous ? path : p);
        else entry.path = path;
        next = { ...draft, mappings: mapping ? draft.mappings.map(m => m.id === source.id ? entry : m) : [...draft.mappings, entry], namespaces: [...draft.namespaces] };
    }
    const oldParent = previous?.split('.').slice(0, -1).join('.');
    for (const keep of [parent, oldParent]) if (keep && !next.namespaces.some(n => n.path === keep)) next.namespaces.push({ path: keep, alwaysVisible: false, description: '' });
    const move = (p: string): string => previous && (source.namespace ? inNamespace(p, previous) : p === previous) ? path + p.slice(previous.length) : p;
    const all = orderedPaths([...namespacePaths(next), ...next.mappings.flatMap(m => [m.path, ...m.aliases])], draft.order.map(move));
    const moving = all.filter(p => source.namespace ? inNamespace(p, path) : p === path);
    const rest = all.filter(p => !moving.includes(p));
    const index = target.position === 'inside' ? rest.length : rest.indexOf(target.path) + Number(target.position === 'after');
    rest.splice(index < 0 ? rest.length : index, 0, ...moving);
    return { ...next, order: rest };
}
