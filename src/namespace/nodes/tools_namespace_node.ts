import { InnerNamespaceNode } from './inner_namespace_node.js';
import { InnerCommandNode } from './inner_command_node.js';
import { InspectCommandNode } from './inspect_command_node.js';
import { ProfileNamespaceNode } from './profile_namespace_node.js';
import type { NamespaceNode } from './node.js';
import type { NamespaceContext } from './context.js';
import { pluginCommands, projectBuiltin } from '../../runtime/builtins.js';

/** @brief Tools owns its protected discovery, search and Profile children with inherited disablement. */
export class ToolsNamespaceNode extends InnerNamespaceNode {
    constructor(parent: NamespaceNode, context: NamespaceContext) {
        super('tools', parent, 'Tool discovery and Profile management', {}, context.disabled?.('tools'));
        for (const source of [pluginCommands.discoveryCommand, pluginCommands.searchCommand]) {
            const builtin = projectBuiltin(source, context.mode ?? 'ptc');
            if (context.disabled?.(builtin.path)) continue;
            const tool = context.tools.find(tool => tool.id === builtin.tool);
            if (!tool && !context.includeUnavailable) continue;
            const entry = { tool: builtin.tool, schema: tool?.parameters ?? {}, output: tool?.output, doc: builtin.description };
            this.install(source === pluginCommands.discoveryCommand ? new InspectCommandNode(this, entry, builtin) : new InnerCommandNode('search', this, entry, projectBuiltin(pluginCommands.searchContract(((tool?.parameters.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? []), context.mode ?? 'ptc')));
        }
        this.install(new ProfileNamespaceNode(this, context));
    }
}

