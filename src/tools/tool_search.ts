import { type PresentationMode } from '../integration/presentation.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { SearchCorpus, searchParameters } from '../search/search.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Agent } from '@deepseek-ai/dsh-agent';

/** @brief Build the search contract directly from the current registered engine selector. */
export function searchDefinition(namespaces: Pick<NamespaceIntegration, 'entries' | 'addition' | 'searchEngines'>, mode: PresentationMode = 'native'): ToolDefinition {
    const selector = namespaces.searchEngines.selector();
    const corpora = new WeakMap<Agent, { generation: string; corpus: SearchCorpus }>();
    return defineTool({
        name: 'tools_search', description: projectBuiltin(pluginCommands.searchCommand, mode).description,
        parameters: searchParameters(selector),
        output: { schema: { type: 'array', items: { type: 'string' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const addition = await namespaces.addition(agent);
            if (!addition.profile.snapshot.resolve(pluginCommands.searchCommand.path)) throw new Error('Execution denied: tools.search');
            const entries = (await namespaces.entries(agent)).map(entry => ({ path: entry.path, tool: entry.tool, schema: entry.schema, output: entry.output, doc: entry.node.serialize().function.doc ?? entry.doc }));
            const generation = JSON.stringify([addition.profile.pointer, entries]);
            let cached = corpora.get(agent);
            if (cached?.generation !== generation) {
                cached = { generation, corpus: new SearchCorpus(entries) };
                corpora.set(agent, cached);
            }
            return cached.corpus.search(args, namespaces.searchEngines.selector());
        },
    });
}

/** @brief Refresh scoped search contracts whenever registered methods or the default change. */
export function registerSearch(ctx: Context, namespaces: NamespaceIntegration): void {
    ctx.effect(() => {
        let dispose = registerBuiltin(ctx, searchDefinition(namespaces));
        const unsubscribe = namespaces.searchEngines.subscribe(() => {
            dispose();
            dispose = registerBuiltin(ctx, searchDefinition(namespaces));
            ctx.emit('system-prompt/change');
        });
        return () => { unsubscribe(); dispose(); };
    });
}
