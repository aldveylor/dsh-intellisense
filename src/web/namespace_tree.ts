import { validatePath } from '../registry/path.js';
import type { Mapping, Namespace } from '../registry/registry.js';

/** @brief The editable tree configuration independent of physical tool identities. */
export interface TreeDraft { mappings: Mapping[]; namespaces: Namespace[]; order: string[] }

/** @brief List explicit and inferred namespace paths. */
export function namespacePaths(draft: Pick<TreeDraft, 'mappings' | 'namespaces'>): string[] {
    return [...new Set([
        ...draft.namespaces.map(n => n.path),
        ...draft.mappings.flatMap(m => [m.path, ...m.aliases].map(path => path.split('.').slice(0, -1).join('.'))),
    ].flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))).filter(Boolean))].sort();
}

/** @brief Match a namespace and its complete subtree without matching similarly named siblings. */
export function inNamespace(path: string, namespace: string): boolean { return path === namespace || path.startsWith(`${namespace}.`); }

/** @brief Preserve mixed namespace/command ordering, appending newly created nodes. */
export function orderedPaths(paths: string[], order: string[]): string[] {
    const rank = new Map(order.map((path, i) => [path, i]));
    return [...paths].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b));
}

/** @brief Rename one namespace, migrating descendants, command paths, metadata and display order together. */
export function renameNamespace(draft: TreeDraft, source: string, name: string): TreeDraft {
    if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new Error('命名空间名称无效。');
    const target = [...source.split('.').slice(0, -1), name].join('.');
    validatePath(`${target}.namespace_check`);
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
