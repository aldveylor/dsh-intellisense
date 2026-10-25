import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { searchEntries, searchParameters } from '../search/search.js';
import { pluginCommands } from '../runtime/builtins.js';
import type { NamespaceComponent } from '../namespace/component.js';
import { registerBuiltin } from './builtin_trace.js';

/** @brief Build the search contract directly from the current registered engine selector. */
export function searchDefinition(namespaces: Pick<NamespaceComponent, 'entries' | 'registryFor' | 'searchEngines'>): ToolDefinition {
    const selector = namespaces.searchEngines.selector();
    return defineTool({
        name: 'tools_search', description: pluginCommands.searchCommand.description,
        parameters: searchParameters(selector),
        output: { schema: { type: 'array', items: { type: 'string' }, description: 'Fully qualified command paths. Use tools.intellisense for full command details.' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const registry = await namespaces.registryFor(agent);
            if (registry.disabled(pluginCommands.searchCommand.path)) throw new Error('Execution denied: tools.search');
            const descriptions = new Map(registry.effective().map(mapping => [mapping.id, mapping.description]));
            const entries = (await namespaces.entries(agent)).map(entry => ({ path: entry.path, tool: entry.tool, argMap: entry.argMap, schema: entry.schema, output: entry.output, doc: descriptions.get(entry.tool) ?? entry.doc }));
            return searchEntries(entries, args, namespaces.searchEngines.selector());
        },
    });
}

/** @brief Refresh scoped search contracts whenever registered methods or the default change. */
export function registerSearch(ctx: Context, namespaces: NamespaceComponent): void {
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
