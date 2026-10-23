import type { Mapping, PhysicalTool } from '../../registry/registry.js';
import { vmCommands, consoleCommands, managementCommands, defaultBuiltinVisible, discoveryCommand } from '../../runtime/builtins.js';

/** @brief Provider command metadata supplies interaction rules independently of its name. */
export interface ProvidedCommand {
    path: string; id?: string; signature?: string; description: string;
    fixed: boolean; draggable: boolean; alwaysVisible: boolean; disabled?: boolean;
}

/** @brief Synthetic namespaces share the ordinary namespace renderer through fixed props. */
export interface ProvidedNamespace { path: string; description: string; fixed: boolean; commands: ProvidedCommand[] }

/** @brief List currently available tools without a mounted path in the active draft. */
export function unmountedTools(tools: PhysicalTool[], mappings: Mapping[]): PhysicalTool[] {
    const mounted = new Set(mappings.filter(mapping => mapping.path.trim()).map(mapping => mapping.id));
    return tools.filter(tool => !tool.id.startsWith('tools_') && !['exec', 'run_code'].includes(tool.id) && !mounted.has(tool.id));
}

/** @brief Provider owns visible, fixed runtime namespaces; unmounted tools use the picker. */
export function TreeProvider(visible: readonly string[] = defaultBuiltinVisible): ProvidedNamespace[] {
    return [{ path: 'tools', description: 'Tool discovery and Profile management', fixed: true,
        commands: [{ ...discoveryCommand, id: 'tools_intellisense', fixed: true, draggable: false, alwaysVisible: true }, ...managementCommands.map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: false, disabled: true }))] },
        { path: 'console', description: 'Native console output', fixed: true,
        commands: consoleCommands.map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: visible.includes(command.path) })) },
        { path: 'vm', description: 'Built-in VM commands', fixed: true,
        commands: vmCommands.map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: visible.includes(command.path) })) }];
}

/** @brief Resolve fixed runtime namespaces and their descendants. */
export function providedNamespace(path: string): ProvidedNamespace | undefined {
    return TreeProvider().find(node => path === node.path || path.startsWith(`${node.path}.`));
}
