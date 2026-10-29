import { ImplBuiltinNamespace } from './impl_builtin_namespace.js';
import { ImplToolsProfileNamespace } from './impl_tools_profile_namespace.js';
import { ImplToolsInspectCommand } from './impl_tools_inspect_command.js';
import { ImplToolsCommand } from './impl_tools_command.js';
import type { ProfileNode } from '../../registry/profile/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../registry/profile_node.js';
import { nodePermissions, type Permission } from '../../namespace/node.js';
import { pluginCommands, projectBuiltin } from '../../runtime/builtins.js';

/** @brief The tools namespace constructs and protects its discovery, search and Profile implementations. */
export class ImplToolsNamespace extends ImplBuiltinNamespace {
    constructor(data?: NamespaceTreeNode) {
        const children = Object.fromEntries([pluginCommands.discoveryCommand, pluginCommands.searchCommand].map(command => [command.path.split('.').at(-1)!, {
            type: 'command' as const, command: { tool: command.tool, doc: projectBuiltin(command, 'ptc').description }, ...(command === pluginCommands.discoveryCommand ? { fixedLevel: 2 as const } : {}),
        }]));
        super('tools', { ...data, type: 'namespace', fixedLevel: 0, description: 'Tool discovery and Profile management',
            children: { ...children, profile: new ImplToolsProfileNamespace().serialize(), ...data?.children } });
    }

    override get permissions(): Permission { return nodePermissions('tree', { ...super.permissions, availableFixLevels: [] }); }

    /** @brief Direct members use their own specialized implementation or shared identical policy. */
    protected override makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        if (name === 'profile' && data.type === 'namespace') return new ImplToolsProfileNamespace(data);
        const command = [pluginCommands.discoveryCommand, pluginCommands.searchCommand].find(command => command.path.split('.').at(-1) === name);
        if (!command || data.type !== 'command') throw new Error(`Invalid builtin tools member: ${name}`);
        const value = { ...data, command: { ...data.command, tool: command.tool } };
        return name === 'inspect' ? new ImplToolsInspectCommand(`tools.${name}`, command.tool, value) : new ImplToolsCommand(`tools.${name}`, command.tool, value);
    }

    /** @brief Saving a target restores fixed namespace values and preserves the documented default disabling rule. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        const result = super.normalize(value) as NamespaceTreeNode;
        return { ...result, fixedLevel: 0, disabled: value.disabled !== false };
    }
}
