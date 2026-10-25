import { InnerNamespaceNode } from './inner_namespace_node.js';
import { InnerCommandNode } from './inner_command_node.js';
import type { NamespaceNode } from './namespace_node.js';
import type { NamespaceContext } from './namespace_context.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Profile management owns creation of its restricted children. */
export class ProfileNamespaceNode extends InnerNamespaceNode {
    constructor(parent: NamespaceNode, context: NamespaceContext) {
        super('profile', parent, 'Profile data and configuration', {}, context.disabled?.('tools.profile'));
        for (const builtin of [...pluginCommands.managementCommands, ...pluginCommands.profileValues]) {
            if (context.disabled?.(builtin.path)) continue;
            const tool = context.tools.find(tool => tool.id === builtin.tool);
            if (!tool && !context.includeUnavailable) continue;
            this.install(new InnerCommandNode(builtin.path.split('.').at(-1)!, this, { tool: builtin.tool, schema: tool?.parameters ?? {}, output: tool?.output, doc: builtin.description }, builtin));
        }
    }
}

