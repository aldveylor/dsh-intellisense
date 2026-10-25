import type { Mapping, PhysicalTool, PinLevel, CommandVisibility } from '../../registry/registry.js';
import { consoleCommands, managementCommands, defaultBuiltinVisible, discoveryCommand, profileValues, searchContract } from '../../runtime/builtins.js';

/** @brief Provider command metadata supplies interaction rules independently of its name. */
export interface ProvidedCommand {
    path: string; id?: string; signature?: string; description: string;
    fixed: boolean; draggable: boolean; alwaysVisible: PinLevel; disabled?: boolean;
}

/** @brief Synthetic namespaces share the ordinary namespace renderer through fixed props. */
export interface ProvidedNamespace { path: string; description: string; fixed: boolean; commands: ProvidedCommand[]; children?: ProvidedNamespace[] }

/** @brief List currently available tools without a mounted path in the active draft. */
export function unmountedTools(tools: PhysicalTool[], mappings: Mapping[]): PhysicalTool[] {
    const mounted = new Set(mappings.filter(mapping => mapping.path.trim()).map(mapping => mapping.id));
    return tools.filter(tool => !tool.id.startsWith('tools_') && !['exec', 'run_code'].includes(tool.id) && !mounted.has(tool.id));
}

/** @brief Provider owns visible, fixed runtime namespaces; unmounted tools use the picker. */
export function TreeProvider(visible: CommandVisibility = defaultBuiltinVisible, searchMethods?: readonly string[]): ProvidedNamespace[] {
    return [{ path: 'tools', description: 'Tool discovery and Profile management', fixed: true,
        commands: [{ ...discoveryCommand, id: 'tools_intellisense', fixed: true, draggable: false, alwaysVisible: 2 }, { ...searchContract(searchMethods), id: 'tools_search', fixed: true, draggable: false, alwaysVisible: visible['tools.search'] ?? 0 }],
        children: [{ path: 'tools.profile', description: 'Profile data and configuration', fixed: true, commands: [...managementCommands, ...profileValues].map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: visible[command.path] ?? 0 })) }] },
        { path: 'console', description: 'Native console output', fixed: true,
        commands: consoleCommands.map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: visible[command.path] ?? 0 })) }];
}

/** @brief Resolve fixed runtime namespaces and their descendants. */
export function providedNamespace(path: string): ProvidedNamespace | undefined {
    const roots = TreeProvider();
    return [...roots.flatMap(node => node.children ?? []), ...roots].find(node => path === node.path || path.startsWith(`${node.path}.`));
}
