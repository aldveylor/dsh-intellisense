import { namespaceDeclaration, type NamespaceDeclaration } from '../namespace/declaration.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { codeBlock } from '../protocol/code_block.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, normalizeInspectQueries, queryNodes, NamespaceNode } from '../namespace/namespace.js';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
/** @brief A valid query target resolved against the active Profile tree. */
export interface QueryTarget { path: string; namespace: boolean; tool?: string }

/** @brief Resolve each query target, excluding disabled and missing members. */
export function inspectQueryTargets(queries: readonly string[], root: NamespaceNode): QueryTarget[] {
    return normalizeInspectQueries(queries).flatMap<QueryTarget>(query => {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path ? path.split('.') : []);
        if (!node || node.disabled) return [];
        if (node instanceof NamespaceNode) return [{ path, namespace: true }];
        return !query.endsWith('.') ? [{ path, namespace: false, tool: node.tool }] : [];
    });
}

/** @brief Render queried members and signatures through the shared namespace declaration model. */
export function inspect(queries: readonly string[], root: NamespaceNode, runtime = false, brief: (tool: string, path: string) => string | undefined = () => undefined): string {
    const selected = new Map<string, NamespaceDeclaration>();
    const exact = new Set(normalizeInspectQueries(queries));
    for (const node of queryNodes(root, queries)) {
        if (node instanceof NamespaceNode) {
            selected.set(node.path, { path: node.path, namespace: true, description: node.description });
            continue;
        }
        const value = runtime && node.preload;
        selected.set(node.path, {
            path: node.path, description: brief(node.tool, node.path) ?? node.doc.trim().split(/\r?\n/, 1)[0],
            ...(value ? { valueType: node.signature }
                : exact.has(node.path) ? { declaration: declaration(node, false) } : {}),
        });
    }
    // Preserve an explicitly queried namespace even when it has no direct children.
    for (const query of exact) {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path.split('.'));
        if (path && node instanceof NamespaceNode && !node.disabled) selected.set(path, { path, namespace: true, description: node.description });
    }
    for (const path of [...selected.keys()]) {
        let parent = root.resolve(path.split('.'))?.parent;
        while (parent?.path) {
            selected.set(parent.path, { path: parent.path, namespace: true, description: parent.description });
            parent = parent.parent;
        }
    }
    return namespaceDeclaration([...selected.values()]);
}

/** @brief Register batched signature discovery as an ordinary guarded native tool. */
export function registerInspect(ctx: Context, namespaces: NamespaceIntegration): void {
    const contract = projectBuiltin(pluginCommands.discoveryCommand, 'native');
    const definition: ToolDefinition = defineTool({
        name: 'tools_inspect',
        description: contract.description,
        parameters: { queries: { type: 'array', items: { type: 'string' }, description: contract.parameterDocs!.queries, required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        presentCall: ({ queries }) => ({ card: 'generic', title: 'tools.inspect', kind: 'read', rawInput: queries }),
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
            if (registry.disabled('tools.inspect')) throw new Error('Execution denied: tools.inspect');
            const root = await namespaces.tree(agent, registry);
            const targets = inspectQueryTargets(queries, root);
            await namespaces.inspectStatistics.increment(registry.profileSelection().selected, targets.map(target => target.path));
            await namespaces.statistics.queries.increment(agent.session.id, targets.flatMap(target => target.tool ? [target.tool] : []));
            let info: string;
            if (namespaces.isPtc(agent)) {
                info = inspect(queries, root, true, (tool, path) => registry.description(path, tool));
            } else {
                info = await namespaces.discover(agent, queries);
            }
            const position = namespaces.position(agent);
            appendPluginRecord(agent.session, 'plugin:ts_intellisense/inspect', {
                ...position, queries, info, elapsedMs: performance.now() - started,
                profileRevision: registry.revision,
                runtimeEpoch: namespaces.isPtc(agent) ? agent.ctx.get('codeRuntime')?.epoch(agent.id) ?? 0 : 0,
            });
            return info;
        },
    });
    ctx.effect(() => registerBuiltin(ctx, definition));
}
