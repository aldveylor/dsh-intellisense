import { ImplBuiltinNamespace } from './impl_builtin_namespace.js';
import { ImplToolsProfileNamespace } from './impl_tools_profile_namespace.js';
import { ImplToolsInspectFunction } from './impl_tools_inspect_function.js';
import { ImplToolsFunction } from './impl_tools_function.js';
import type { ProfileNode } from '../../profile/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../profile/catalog/profile_node.js';
import { nodePermissions, type Permission } from '../../profile/namespace/node.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief The tools namespace constructs and protects its discovery, search and Profile implementations. */
export class ImplToolsNamespace extends ImplBuiltinNamespace {
    constructor(data?: NamespaceTreeNode) {
        const children = Object.fromEntries([pluginCommands.discoveryCommand, pluginCommands.searchCommand].map(command => [command.path.split('.').at(-1)!, {
            type: 'function' as const, function: { tool: command.tool }, ...(command === pluginCommands.discoveryCommand ? { fixedLevel: 2 as const } : {}),
        }]));
        super('tools', { ...data, type: 'namespace', fixedLevel: 0, description: 'Tool discovery and Profile management',
            children: { ...children, profile: new ImplToolsProfileNamespace().serialize(), ...data?.children } });
    }

    /** @brief Stored values do not change the tools namespace's fixed level. */
    override copyNode(value: ProfileTreeNode): this { return super.copyNode({ ...value, fixedLevel: 0 } as NamespaceTreeNode); }

    override get permissions(): Permission { return nodePermissions('tree', { ...super.permissions, availableFixLevels: [] }); }

    /** @brief Direct members use their own specialized implementation or shared identical policy. */
    protected override makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        if (name === 'profile' && data.type === 'namespace') return new ImplToolsProfileNamespace(data);
        const command = [pluginCommands.discoveryCommand, pluginCommands.searchCommand].find(command => command.path.split('.').at(-1) === name);
        if (!command || data.type !== 'function') throw new Error(`Invalid builtin tools member: ${name}`);
        const value = { ...data, function: { tool: command.tool } };
        return name === 'inspect' ? new ImplToolsInspectFunction(`tools.${name}`, command.tool, value) : new ImplToolsFunction(`tools.${name}`, command.tool, value);
    }

    /** @brief Saving a target restores fixed namespace values and preserves the documented default disabling rule. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        const result = super.normalize(value) as NamespaceTreeNode;
        return { ...result, fixedLevel: 0, disabled: value.disabled !== false };
    }
}
