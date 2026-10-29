import type { ProfileSnapshot } from '../profile.js';
import { outputSchema } from '../../output_schema.js';
import { createHash } from 'node:crypto';
import { normalizeInspectQueries, queryNodes, type CommandEntry } from './namespace.js';

/** @brief Bind namespace paths to unique API-safe names without shadowing physical tools. */
export function nativeBindings(entries: CommandEntry[], reserved: Iterable<string>): { entry: CommandEntry; name: string }[] {
    const physical = new Set(reserved);
    const used = new Set<string>();
    const counters = new Map<string, number>();
    return entries.map(entry => {
        const encoded = 'ns_' + entry.path.replace(/[^a-zA-Z0-9_-]/g, char => char === '.' ? '__' : `_${char.charCodeAt(0).toString(16)}_`);
        const base = encoded.length <= 64 ? encoded : 'ns_' + createHash('sha256').update(entry.path).digest('hex').slice(0, 61);
        let name = base;
        for (let index = counters.get(base) ?? 1; used.has(name) || (physical.has(name) && (name !== entry.tool || !entry.path.startsWith('tools.'))); index++) {
            const suffix = `_${index}`;
            name = base.length + suffix.length <= 64 ? base + suffix
                : 'ns_' + createHash('sha256').update(`${entry.path}\0${index}`).digest('hex').slice(0, 61);
            counters.set(base, index + 1);
        }
        used.add(name);
        return { entry, name };
    });
}

/** @brief Select only exact commands from original Profile nodes and their available physical contracts. */
export function nativeQueryEntries(queries: readonly string[], profile: ProfileSnapshot, entries: readonly CommandEntry[]): CommandEntry[] {
    const exact = new Set(normalizeInspectQueries(queries));
    const paths = new Set(queryNodes(profile, queries).filter(({ path, node }) => node.type === 'command' && exact.has(path)).map(({ path }) => path));
    return entries.filter(entry => paths.has(entry.path));
}

/** @brief Render shallow discovery directly from Profile nodes and flat physical metadata. */
export function nativeDiscovery(queries: readonly string[], profile: ProfileSnapshot, entries: readonly CommandEntry[]): string {
    const exact = new Set(normalizeInspectQueries(queries));
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    const members = queryNodes(profile, queries).sort((a, b) => a.path.localeCompare(b.path)).flatMap<Record<string, unknown>>(({ path, node }) => {
        const data = node.serialize();
        if (node.type === 'namespace') return [{ path, namespace: true, ...(data.description?.trim() ? { brief: data.description } : {}) }];
        const entry = byPath.get(path);
        if (!entry) return [];
        const brief = entry.provided ? entry.doc : data.command?.doc ?? entry.doc.trim().split(/\r?\n/, 1)[0];
        return [{ path, ...(brief?.trim() ? { brief } : {}), ...(exact.has(path) ? { description: entry.doc, parameters: entry.schema, output: outputSchema(entry.output) } : {}) }];
    });
    return JSON.stringify({ members }, null, 2);
}
