import { createHash } from 'node:crypto';
import { nativeSchema, type ManifestEntry } from './namespace.js';

/** @brief Bind namespace paths to unique API-safe names without shadowing physical tools. */
export function nativeBindings(entries: ManifestEntry[], reserved: Iterable<string>): { entry: ManifestEntry; name: string }[] {
    const physical = new Set(reserved);
    const used = new Set<string>();
    return entries.map(entry => {
        const encoded = entry.path.replace(/[^a-zA-Z0-9_-]/g, char => char === '.' ? '__' : `_${char.charCodeAt(0).toString(16)}_`);
        const base = encoded.length <= 64 ? encoded : createHash('sha256').update(entry.path).digest('hex');
        let name = base;
        for (let index = 1; used.has(name) || (physical.has(name) && (name !== entry.tool || !entry.path.startsWith('tools.') || entry.argMap)); index++) {
            const suffix = `_${index}`;
            name = base.slice(0, 64 - suffix.length) + suffix;
        }
        used.add(name);
        return { entry, name };
    });
}

/** @brief Select exact commands or immediate namespace members without expanding descendants. */
export function nativeQueryEntries(queries: readonly string[], entries: readonly ManifestEntry[]): ManifestEntry[] {
    for (const query of queries) {
        if (query !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(query)) throw new Error(`Invalid IntelliSense query: ${query}`);
    }
    return entries.filter(entry => queries.some(query => {
        if (query === entry.path) return true;
        const prefix = query ? query.replace(/\.$/, '') + '.' : '';
        return entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes('.');
    }));
}

/** @brief Render shallow native discovery and exact named-argument contracts as JSON. */
export function nativeDiscovery(queries: readonly string[], bindings: readonly { entry: ManifestEntry; name: string }[]): string {
    const selected = new Set(nativeQueryEntries(queries, bindings.map(binding => binding.entry)).map(entry => entry.path));
    const members = new Map<string, unknown>();
    for (const { entry, name } of bindings) {
        if (selected.has(entry.path)) members.set(entry.path, {
            path: entry.path, tool: name, description: entry.doc,
            ...(queries.includes(entry.path) ? { parameters: nativeSchema(entry), output: entry.output } : {}),
        });
        for (const query of queries) {
            if (query === entry.path) continue;
            const prefix = query ? query.replace(/\.$/, '') + '.' : '';
            if (!entry.path.startsWith(prefix)) continue;
            const path = prefix + entry.path.slice(prefix.length).split('.')[0]!;
            if (path !== entry.path) members.set(path, { path, namespace: true });
        }
    }
    return JSON.stringify({ members: [...members].sort(([a], [b]) => a.localeCompare(b)).map(([, member]) => member) }, null, 2);
}
