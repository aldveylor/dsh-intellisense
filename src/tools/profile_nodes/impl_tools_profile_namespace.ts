import { ImplBuiltinNamespace } from './impl_builtin_namespace.js';
import { ImplToolsCommand } from './impl_tools_command.js';
import type { ProfileNode } from '../../registry/profile/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../registry/profile_node.js';
import { pluginCommands, projectBuiltin } from '../../runtime/builtins.js';

/** @brief Profile management owns a closed set of commands sharing one permission implementation. */
export class ImplToolsProfileNamespace extends ImplBuiltinNamespace {
    constructor(data?: NamespaceTreeNode) {
        const children = Object.fromEntries([...pluginCommands.managementCommands, ...pluginCommands.profileValues].map(command => {
            const name = command.path.split('.').at(-1)!;
            return [name, { type: 'command' as const, command: { tool: command.tool, doc: projectBuiltin(command, 'ptc').description } }];
        }));
        super('tools.profile', { ...data, type: 'namespace', description: 'Profile data and configuration', children: { ...children, ...data?.children } });
    }

    /** @brief Hydration selects the shared builtin command implementation, never caller-supplied permissions. */
    protected override makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        const command = [...pluginCommands.managementCommands, ...pluginCommands.profileValues].find(command => command.path.split('.').at(-1) === name);
        if (!command || data.type !== 'command') throw new Error(`Invalid builtin Profile member: ${name}`);
        return new ImplToolsCommand(`tools.profile.${name}`, command.tool, { ...data, command: { ...data.command, tool: command.tool } });
    }
}
