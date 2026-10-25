import { outputSchema } from '../output_schema.js';
import { createHash } from 'node:crypto';
import { nativeSchema, normalizeIntellisenseQueries, queryNodes, CommandNode, NamespaceNode } from './namespace.js';

/** @brief Bind namespace paths to unique API-safe names without shadowing physical tools. */
export function nativeBindings(entries: CommandNode[], reserved: Iterable<string>): { entry: CommandNode; name: string }[] {
    const physical = new Set(reserved);
    const used = new Set<string>();
    const counters = new Map<string, number>();
    return entries.map(entry => {
        const encoded = 'ns_' + entry.path.replace(/[^a-zA-Z0-9_-]/g, char => char === '.' ? '__' : `_${char.charCodeAt(0).toString(16)}_`);
        const base = encoded.length <= 64 ? encoded : 'ns_' + createHash('sha256').update(entry.path).digest('hex').slice(0, 61);
        let name = base;
        for (let index = counters.get(base) ?? 1; used.has(name) || (physical.has(name) && (name !== entry.tool || !entry.path.startsWith('tools.') || entry.argMap)); index++) {
            const suffix = `_${index}`;
            name = base.length + suffix.length <= 64 ? base + suffix
                : 'ns_' + createHash('sha256').update(`${entry.path}\0${index}`).digest('hex').slice(0, 61);
            counters.set(base, index + 1);
        }
        used.add(name);
        return { entry, name };
    });
}

/** @brief Select only explicitly queried command paths for native tool registration. */
export function nativeQueryEntries(queries: readonly string[], root: NamespaceNode): CommandNode[] {
    const exact = new Set(normalizeIntellisenseQueries(queries));
    return queryNodes(root, queries).filter((node): node is CommandNode => node instanceof CommandNode && node.deployment === 'tool' && exact.has(node.path));
}

/** @brief Render shallow native discovery and exact named-argument contracts as JSON. */
export function nativeDiscovery(queries: readonly string[], root: NamespaceNode, bindings: readonly { entry: CommandNode; name: string }[], brief: (tool: string) => string | undefined = () => undefined): string {
    const names = new Map(bindings.map(({ entry, name }) => [entry, name]));
    const exact = new Set(normalizeIntellisenseQueries(queries));
    const members = queryNodes(root, queries).sort((a, b) => a.path.localeCompare(b.path)).map(node => {
        const description = node instanceof NamespaceNode ? node.description : brief(node.tool) ?? node.doc.trim().split(/\r?\n/, 1)[0];
        return { path: node.path, ...(description?.trim() ? { brief: description } : {}),
            ...(node instanceof NamespaceNode ? { namespace: true } : {
                deployment: node.deployment,
                ...(node.deployment === 'tool' ? {} : { tool: names.get(node), description: node.doc }),
                ...(exact.has(node.path) ? { parameters: nativeSchema(node), output: outputSchema(node.output) } : {}),
            }) };
    });
    return JSON.stringify({ members }, null, 2);
}
