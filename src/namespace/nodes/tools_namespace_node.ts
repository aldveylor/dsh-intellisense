import { InnerNamespaceNode } from './inner_namespace_node.js';
import { InnerCommandNode } from './inner_command_node.js';
import { IntellisenseCommandNode } from './intellisense_command_node.js';
import { ProfileNamespaceNode } from './profile_namespace_node.js';
import type { NamespaceNode } from './namespace_node.js';
import type { NamespaceContext } from './namespace_context.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Tools owns its protected discovery, search and Profile children and cannot be disabled. */
export class ToolsNamespaceNode extends InnerNamespaceNode {
    constructor(parent: NamespaceNode, context: NamespaceContext) {
        super('tools', parent, 'Tool discovery and Profile management', { disableable: false });
        for (const builtin of [pluginCommands.discoveryCommand, pluginCommands.searchCommand]) {
            if (context.disabled?.(builtin.path)) continue;
            const tool = context.tools.find(tool => tool.id === builtin.tool);
            if (!tool && !context.includeUnavailable) continue;
            const entry = { tool: builtin.tool, schema: tool?.parameters ?? {}, output: tool?.output, doc: builtin.description };
            this.install(builtin === pluginCommands.discoveryCommand ? new IntellisenseCommandNode(this, entry) : new InnerCommandNode('search', this, entry, pluginCommands.searchContract(((tool?.parameters.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? [])));
        }
        this.install(new ProfileNamespaceNode(this, context));
    }
}

