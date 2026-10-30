import { namespaceDeclaration, type NamespaceDeclaration } from '../profile/namespace/declaration.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { codeBlock } from '../protocol/code_block.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, normalizeInspectQueries, queryNodes, type FunctionEntry } from '../profile/namespace/namespace.js';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import type { ProfileSnapshot } from '../profile/profile.js';
import type { ProfileFunction } from '../profile/function.js';

/** @brief A valid query target resolved against the active Profile tree. */
export interface QueryTarget { path: string; namespace: boolean; tool?: string }

/** @brief Resolve each query target, excluding disabled and missing members. */
export function inspectQueryTargets(queries: readonly string[], profile: ProfileSnapshot): QueryTarget[] {
    return normalizeInspectQueries(queries).flatMap<QueryTarget>(query => {
        const path = query.replace(/\.$/, '');
        const node = profile.resolve(path);
        if (!node) return [];
        if (node.type === 'namespace') return [{ path, namespace: true }];
        return node.type === 'function' && !query.endsWith('.') ? [{ path, namespace: false, tool: (node as ProfileFunction).tool }] : [];
    });
}

/** @brief Render selected original nodes and supplement commands with scoped physical contracts. */
export function inspect(queries: readonly string[], profile: ProfileSnapshot, entries: readonly FunctionEntry[], runtime = false): string {
    const selected = new Map<string, NamespaceDeclaration>();
    const exact = new Set(normalizeInspectQueries(queries));
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    for (const { path, node } of queryNodes(profile, queries)) {
        const data = node.serialize();
        if (node.type === 'namespace') {
            selected.set(path, { path, namespace: true, description: data.description });
            continue;
        }
        const entry = byPath.get(path);
        if (!entry) continue;
        selected.set(path, { path, description: entry.provided ? entry.doc : data.function?.doc ?? entry.doc.trim().split(/\r?\n/, 1)[0],
            ...(runtime && entry.preload ? { valueType: entry.signature } : exact.has(path) ? { declaration: declaration(entry, false) } : {}) });
    }
    for (const query of exact) {
        const path = query.replace(/\.$/, '');
        const node = profile.resolve(path);
        if (path && node?.type === 'namespace') selected.set(path, { path, namespace: true, description: node.serialize().description });
    }
    for (const path of [...selected.keys()]) {
        const parts = path.split('.');
        while (parts.length > 1) {
            parts.pop();
            const parent = parts.join('.');
            selected.set(parent, { path: parent, namespace: true, description: profile.resolve(parent)?.serialize().description });
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
                ? { type: 'text' as const, text: codeBlock(block.text, result.isError || block.text === 'success' ? 'text' : block.text.trimStart().startsWith('{') ? 'json' : 'typescript') }
                : block);
            return { card: 'generic', content: [{ type: 'text', text: `Schema\n\n${codeBlock(schema, 'json')}\n\nResult` }, ...content] };
        },
        execute: async ({ queries }, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const started = performance.now();
            const addition = await namespaces.addition(agent);
            const profile = addition.profile.snapshot;
            if (!profile.resolve('tools.inspect')) throw new Error('Execution denied: tools.inspect');
            const targets = inspectQueryTargets(queries, profile);
            await namespaces.inspectStatistics.increment(addition.name, targets.map(target => target.path));
            await namespaces.statistics.queries.increment(agent.session.id, targets.flatMap(target => target.tool ? [target.tool] : []));
            const info = await namespaces.discover(agent, queries);
            const position = namespaces.position(agent);
            appendPluginRecord(agent.session, 'plugin:ts_intellisense/inspect', {
                ...position, queries, info, elapsedMs: performance.now() - started,
                profileRevision: addition.profile.pointer,
                runtimeEpoch: namespaces.isPtc(agent) ? agent.ctx.get('codeRuntime')?.epoch(agent.id) ?? 0 : 0,
            });
            return info;
        },
    });
    ctx.effect(() => registerBuiltin(ctx, definition));
}
