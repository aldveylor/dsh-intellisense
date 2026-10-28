import { presentationFor, type PresentationMode } from '../integration/presentation.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { SearchCorpus, searchParameters } from '../search/search.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import type { NamespaceComponent } from '../namespace/component.js';
import { registerBuiltin } from './builtin_trace.js';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief Build the search contract directly from the current registered engine selector. */
export function searchDefinition(namespaces: Pick<NamespaceComponent, 'entries' | 'registryFor' | 'searchEngines'>, mode: PresentationMode = 'native'): ToolDefinition {
    const selector = namespaces.searchEngines.selector();
    const corpora = new WeakMap<SemanticRegistry, { generation: string; corpus: SearchCorpus }>();
    return defineTool({
        name: 'tools_search', description: projectBuiltin(pluginCommands.searchCommand, mode).description,
        parameters: searchParameters(selector),
        output: { schema: { type: 'array', items: { type: 'string' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const registry = await namespaces.registryFor(agent);
            if (registry.disabled(pluginCommands.searchCommand.path)) throw new Error('Execution denied: tools.search');
            let cached = corpora.get(registry);
            if (cached?.generation !== registry.generation) {
                const generation = registry.generation;
                const entries = (await namespaces.entries(agent, registry)).map(entry => ({ path: entry.path, tool: entry.tool, schema: entry.schema, output: entry.output, doc: registry.description(entry.path, entry.tool) ?? entry.doc }));
                cached = { generation, corpus: new SearchCorpus(entries) };
                corpora.set(registry, cached);
            }
            return cached.corpus.search(args, namespaces.searchEngines.selector());
        },
    });
}

/** @brief Refresh scoped search contracts whenever registered methods or the default change. */
export function registerSearch(ctx: Context, namespaces: NamespaceComponent): void {
    ctx.effect(() => {
        let dispose = registerBuiltin(ctx, searchDefinition(namespaces, presentationFor(ctx) ?? 'native'));
        const unsubscribe = namespaces.searchEngines.subscribe(() => {
            dispose();
            dispose = registerBuiltin(ctx, searchDefinition(namespaces, presentationFor(ctx) ?? 'native'));
            ctx.emit('system-prompt/change');
        });
        return () => { unsubscribe(); dispose(); };
    });
}
