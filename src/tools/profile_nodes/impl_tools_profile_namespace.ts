import { ImplBuiltinNamespace } from './impl_builtin_namespace.js';
import { ImplToolsFunction } from './impl_tools_function.js';
import type { ProfileNode } from '../../profile/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../profile/catalog/profile_node.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Profile management owns a closed set of functions sharing one permission implementation. */
export class ImplToolsProfileNamespace extends ImplBuiltinNamespace {
    constructor(data?: NamespaceTreeNode) {
        const children = Object.fromEntries([...pluginCommands.managementCommands, ...pluginCommands.profileValues].map(command => {
            const name = command.path.split('.').at(-1)!;
            return [name, { type: 'function' as const, function: { tool: command.tool, doc: command.brief } }];
        }));
        super('tools.profile', { ...data, type: 'namespace', description: 'Profile data and configuration', children: { ...children, ...data?.children } });
    }

    /** @brief Hydration selects the shared builtin function implementation, never caller-supplied permissions. */
    protected override makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        const command = [...pluginCommands.managementCommands, ...pluginCommands.profileValues].find(command => command.path.split('.').at(-1) === name);
        if (!command || data.type !== 'function') throw new Error(`Invalid builtin Profile member: ${name}`);
        return new ImplToolsFunction(`tools.profile.${name}`, command.tool, { ...data, function: { tool: command.tool, doc: command.brief } });
    }
}
