import { CommandNode, NamespaceNode, createNamespace, nativeArgumentsFor, type ManifestEntry } from '../../src/namespace/namespace.js';
import { pluginCommands } from '../../src/runtime/builtins.js';
import { RuntimeHost } from '../../src/runtime/host.js';

/** @brief Build a real server-owned tree around a physical test catalog. */
export function namespace(entries: readonly ManifestEntry[] = []): NamespaceNode {
    const root = createNamespace({ tools: entries.map(entry => ({ id: entry.tool, description: entry.doc, parameters: entry.schema, output: entry.output })) });
    for (const entry of entries) {
        if (pluginCommands.find(entry.tool)) continue;
        let parent = root;
        const parts = entry.path.split('.');
        for (const name of parts.slice(0, -1)) parent = parent.children.get(name) as NamespaceNode ?? parent.add(new NamespaceNode(name, parent));
        parent.add(new CommandNode(parts.at(-1)!, parent, entry));
    }
    return root;
}

/** @brief Exercise positional conversion in the real guest and native validation at dispatch. */
export async function positionalArguments(entry: ManifestEntry, args: unknown[]): Promise<unknown> {
    const command = namespace([entry]).resolve(entry.path.split('.')) as CommandNode;
    const host = new RuntimeHost({ timeoutMs: 3000 });
    let received: unknown;
    try {
        const source = args.map(arg => arg === undefined ? 'undefined' : JSON.stringify(arg)).join(',');
        const result = await host.execute('arguments', 'call', `await ${entry.path}(${source});`, [command.binding()], async (_tool, input) => {
            received = nativeArgumentsFor(entry, input);
            return null;
        }, new AbortController().signal);
        if (result.error) throw new Error(result.error);
        return received;
    } finally { await host.dispose(); }
}
