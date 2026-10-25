import { InnerNamespaceNode } from './inner_namespace_node.js';
import { EnvironmentCommandNode } from './environment_command_node.js';
import type { NamespaceNode } from './namespace_node.js';
import type { NamespaceContext } from './namespace_context.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Console describes the existing runtime object and owns its protected environment leaves. */
export class ConsoleNamespaceNode extends InnerNamespaceNode {
    constructor(parent: NamespaceNode, context: NamespaceContext) {
        super('console', parent, 'Native console output', { availableFixLevels: [0, 1] }, context.disabled?.('console'));
        if (context.disabled?.(this.path)) return;
        for (const contract of pluginCommands.consoleCommands) if (!context.disabled?.(contract.path)) this.install(new EnvironmentCommandNode(contract.path.split('.').at(-1)!, this, contract));
    }
}

