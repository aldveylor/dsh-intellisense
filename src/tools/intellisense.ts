import { namespaceDeclaration, type NamespaceDeclaration } from '../namespace/declaration.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { codeBlock } from '../protocol/code_block.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, normalizeIntellisenseQueries, queryNodes, NamespaceNode } from '../namespace/namespace.js';
import type { NamespaceComponent } from '../namespace/component.js';
import type { QueryTarget } from '../namespace/statistics.js';

/** @brief Resolve each query target, excluding disabled, missing and runtime-only members. */
export function intellisenseQueryTargets(queries: readonly string[], root: NamespaceNode): QueryTarget[] {
    return normalizeIntellisenseQueries(queries).flatMap<QueryTarget>(query => {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path ? path.split('.') : []);
        if (!node || node.disabled) return [];
        if (node instanceof NamespaceNode) {
            const commands = node.commands().filter(command => !command.disabled);
            if (commands.length && commands.every(command => command.deployment === 'environment')) return [];
            return [{ path, namespace: true }];
        }
        return !query.endsWith('.') && node.deployment === 'tool' ? [{ path, namespace: false }] : [];
    });
}

/** @brief Render queried members and signatures through the shared namespace declaration model. */
export function intellisense(queries: readonly string[], root: NamespaceNode, runtime = false, disabled: (path: string) => boolean = () => false, brief: (tool: string) => string | undefined = () => undefined): string {
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
            path: node.path, description: brief(node.tool) ?? node.doc.trim().split(/\r?\n/, 1)[0],
            ...(value ? { valueType: node.signature }
                : exact.has(node.path) ? { declaration: declaration(node, false) } : {}),
        });
    }
    // Preserve an explicitly queried namespace even when it has no direct children.
    for (const query of exact) {
        const path = query.replace(/\.$/, '');
        if (path && root.resolve(path.split('.')) instanceof NamespaceNode) selected.set(path, { path, namespace: true });
    }
    return namespaceDeclaration([...selected.values()]);
}

/** @brief Register batched signature discovery as an ordinary guarded native tool. */
export function registerIntellisense(ctx: Context, namespaces: NamespaceComponent): void {
    const definition: ToolDefinition = defineTool({
        name: 'tools_intellisense',
        description: 'Query namespace members with a trailing dot, or complete tool signatures by exact path. An empty string ("") in queries lists root namespace members, e.g. {"queries":[""]}. Discovers commands progressively. Call through tools.intellisense.',
        parameters: { queries: { type: 'array', items: { type: 'string' }, description: 'Namespace member paths or exact command paths. An optional global. prefix is ignored. Include an empty string ("") to list root namespace members, e.g. [""].', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
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
            const root = await namespaces.tree(agent);
            await namespaces.statistics.recordQueries(agent.id, intellisenseQueryTargets(queries, root));
            let info: string;
            if (namespaces.isPtc(agent)) {
                const briefs = new Map(registry.effective().map(mapping => [mapping.id, mapping.description]));
                info = intellisense(queries, root, true, path => registry.disabled(path), tool => briefs.get(tool));
            } else {
                const discovery = JSON.parse(await namespaces.discover(agent, queries));
                discovery.members = (discovery.members ?? []).filter((member: { path: string }) => {
                    const node = root.resolve(member.path.split('.'));
                    if (!node || node.disabled) return false;
                    return node instanceof NamespaceNode
                        ? node.commands().some(command => !command.disabled && command.deployment === 'tool')
                        : node.deployment === 'tool';
                });
                info = JSON.stringify(discovery, null, 2);
            }
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
