import type { Mapping, PhysicalTool, PinLevel, CommandVisibility } from '../../registry/registry.js';
import { nodePermissions, type NodePermissions } from '../../integration/node.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Provider command metadata supplies interaction rules independently of its name. */
export interface ProvidedCommand {
    path: string; id?: string; signature?: string; description: string;
    permissions: NodePermissions; alwaysVisible: PinLevel; disabled?: boolean;
}

/** @brief Synthetic namespaces share the ordinary namespace renderer through fixed props. */
export interface ProvidedNamespace { path: string; description: string; permissions: NodePermissions; commands: ProvidedCommand[]; children?: ProvidedNamespace[] }

/** @brief List currently available tools without a mounted path in the active draft. */
export function unmountedTools(tools: PhysicalTool[], mappings: Mapping[]): PhysicalTool[] {
    const mounted = new Set(mappings.filter(mapping => mapping.path.trim()).map(mapping => mapping.id));
    return tools.filter(tool => !tool.id.startsWith('tools_') && !['exec', 'run_code'].includes(tool.id) && !mounted.has(tool.id));
}

/** @brief Provider owns visible, fixed runtime namespaces; unmounted tools use the picker. */
export function TreeProvider(visible: CommandVisibility = pluginCommands.defaultBuiltinVisible, searchMethods?: readonly string[]): ProvidedNamespace[] {
    return [{ path: 'tools', description: 'Tool discovery and Profile management', permissions: nodePermissions('inner_namespace', 'tools'),
        commands: [{ ...pluginCommands.discoveryCommand, id: 'tools_intellisense', permissions: nodePermissions('inner_command', pluginCommands.discoveryCommand.path), alwaysVisible: 2 }, { ...pluginCommands.searchContract(searchMethods), id: 'tools_search', permissions: nodePermissions('inner_command', pluginCommands.searchCommand.path), alwaysVisible: visible['tools.search'] ?? 0 }],
        children: [{ path: 'tools.profile', description: 'Profile data and configuration', permissions: nodePermissions('inner_namespace', 'tools.profile'), commands: [...pluginCommands.managementCommands, ...pluginCommands.profileValues].map(command => ({ ...command, permissions: nodePermissions('inner_command', command.path), alwaysVisible: visible[command.path] ?? 0 })) }] },
        { path: 'console', description: 'Native console output', permissions: nodePermissions('inner_namespace', 'console'),
        commands: pluginCommands.consoleCommands.map(command => ({ ...command, permissions: nodePermissions('inner_command', command.path), alwaysVisible: visible[command.path] ?? 0 })) }];
}

/** @brief Resolve fixed runtime namespaces and their descendants. */
export function providedNamespace(path: string): ProvidedNamespace | undefined {
    const roots = TreeProvider();
    return [...roots.flatMap(node => node.children ?? []), ...roots].find(node => path === node.path || path.startsWith(`${node.path}.`));
}
