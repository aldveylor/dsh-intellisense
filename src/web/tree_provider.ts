import type { Mapping, PhysicalTool } from '../registry/registry.js';
import { toolName } from '../registry/path.js';
import { vmCommands } from '../runtime/builtins.js';

/** @brief Provider command metadata supplies interaction rules independently of its name. */
export interface ProvidedCommand {
    path: string; id?: string; signature?: string; description: string;
    fixed: boolean; draggable: boolean; alwaysVisible: boolean;
}

/** @brief Synthetic namespaces share the ordinary namespace renderer through fixed props. */
export interface ProvidedNamespace { path: string; description: string; fixed: boolean; commands: ProvidedCommand[] }

/** @brief Provider owns runtime commands and the unmounted-tool namespace. */
export function TreeProvider(tools: PhysicalTool[], mappings: Mapping[], visible: string[]): ProvidedNamespace[] {
    return [
        { path: 'vm', description: 'Built-in VM commands', fixed: true,
            commands: vmCommands.map(command => ({ ...command, fixed: true, draggable: false, alwaysVisible: true })) },
        { path: 'unknown', description: 'Unmapped tools', fixed: true,
            commands: tools.filter(tool => !mappings.some(mapping => mapping.id === tool.id && mapping.path.trim()))
                .map(tool => ({ id: tool.id, path: `unknown.${toolName(tool.id)}`, description: tool.description,
                    fixed: false, draggable: true, alwaysVisible: visible.includes(tool.id) })) },
    ];
}

/** @brief Resolve provider ownership and interaction policies for tree operations. */
export function providedNamespace(path: string): ProvidedNamespace | undefined {
    return TreeProvider([], [], []).find(node => path === node.path || path.startsWith(`${node.path}.`));
}
