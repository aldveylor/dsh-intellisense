import { namespaceDeclaration, type NamespaceDeclaration } from '../namespace/declaration.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { codeBlock } from '../protocol/code_block.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, normalizeIntellisenseQueries, queryNodes, NamespaceNode } from '../namespace/namespace.js';
import { profileAnnotation } from '../registry/profile_tree.js';
import type { NamespaceComponent } from '../namespace/component.js';

/** @brief Render queried members and signatures through the shared namespace declaration model. */
export function intellisense(queries: readonly string[], root: NamespaceNode, runtime = false, disabled: (path: string) => boolean = () => false): string {
    const selected = new Map<string, NamespaceDeclaration>();
    const exact = new Set(normalizeIntellisenseQueries(queries));
    for (const node of queryNodes(root, queries)) {
        if (disabled(node.path)) continue;
        if (node instanceof NamespaceNode) {
            selected.set(node.path, { path: node.path, namespace: true });
            continue;
        }
        const value = runtime && node.preload;
        selected.set(node.path, {
            path: node.path, description: node.doc,
            ...(value ? { valueType: node.signature }
                : exact.has(node.path) ? { declaration: declaration(node, false) } : {}),
        });
    }
    // Preserve an explicitly queried namespace even when it has no direct children.
    for (const query of exact) {
        const path = query.replace(/\.$/, '');
        if (path && root.resolve(path.split('.')) instanceof NamespaceNode) selected.set(path, { path, namespace: true });
    }
    return profileAnnotation + '\n\n' + namespaceDeclaration([...selected.values()]);
}

/** @brief Register batched signature discovery as an ordinary guarded native tool. */
export function registerIntellisense(ctx: Context, namespaces: NamespaceComponent): void {
    const definition: ToolDefinition = defineTool({
        name: 'tools_intellisense',
        description: 'Query namespace members with a trailing dot, or complete tool signatures by exact path. An empty string ("") in queries lists root namespace members, e.g. {"queries":[""]}. Discovers commands progressively. Call through tools.intellisense.',
        parameters: { queries: { type: 'array', items: { type: 'string' }, description: 'Namespace member paths or exact command paths. An optional global. prefix is ignored. Include an empty string ("") to list root namespace members, e.g. [""].', required: true } },
        output: { schema: { type: 'string', description: 'TypeScript namespace declarations in PTC mode, or a JSON object containing namespace members and exact tool contracts in native mode.' }, render: (_args, value) => [{ type: 'text', text: value }] },
        presentCall: ({ queries }) => ({ card: 'generic', title: 'tools.intellisense', kind: 'read', rawInput: queries }),
        presentResult: (_args, result) => {
            const schema = JSON.stringify({ name: definition.name, description: definition.description, parameters: definition.parameters, output: definition.output.schema }, null, 2);
            const content = result.content.map(block => block.type === 'text'
                ? { type: 'text' as const, text: codeBlock(block.text, result.isError ? 'text' : block.text.trimStart().startsWith('{') ? 'json' : 'typescript') }
                : block);
            return { card: 'generic', content: [{ type: 'text', text: `Schema\n\n${codeBlock(schema, 'json')}\n\nResult` }, ...content] };
        },
        execute: async ({ queries }, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const started = performance.now();
            const registry = await namespaces.registryFor(agent);
            const info = namespaces.isPtc(agent)
                ? intellisense(queries, await namespaces.tree(agent), true, path => registry.disabled(path))
                : await namespaces.discover(agent, queries);
            const position = namespaces.position(agent);
            appendPluginRecord(agent.session, 'plugin:ts_intellisense/intellisense', {
                ...position, queries, info, elapsedMs: performance.now() - started,
                profileRevision: (await namespaces.registryFor(agent)).snapshot().revision,
                runtimeEpoch: namespaces.isPtc(agent) ? agent.ctx.get('codeRuntime')?.epoch(agent.id) ?? 0 : 0,
            });
            return info;
        },
    });
    ctx.effect(() => registerBuiltin(ctx, definition));
}
