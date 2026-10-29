import { pluginCommands, projectBuiltin, ptcToolName } from '../runtime/builtins.js';
import type { ToolsNamespace } from './service.js';
import { profileAnnotation } from '../registry/profile_tree.js';
import { RootNamespace } from '../tools/profile_nodes/root_namespace.js';

/** @brief Define plugin tools exclusively through the portable namespace registration API. */
export function registerBuiltinDefinitions(service: Pick<ToolsNamespace, 'setToolAddition' | 'createInitialProfile'>): void {
    service.createInitialProfile = () => new RootNamespace();
    for (const tool of ['exec', 'run_code', ptcToolName]) service.setToolAddition(tool, { hidden: true });
    for (const command of pluginCommands.builtinTools) service.setToolAddition(command.tool, {
        fixed: true,
        discovery: command === pluginCommands.discoveryCommand,
        project: (schema, mode, discoveryAvailable) => {
            const source = command === pluginCommands.searchCommand
                ? pluginCommands.searchContract(((schema.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? []) : command;
            const projected = projectBuiltin(source, mode);
            return { ...projected, description: discoveryAvailable ? projected.description : projected.description.replace(projected.discoveryHint ?? '', '') };
        },
        ...(command.preload ? { value: {
            read: async (namespace, registry) => {
                if (command.tool === 'tools_profile_annotation') return profileAnnotation;
                if (command.tool === 'tools_profile_commands') return (await namespace.commandBriefs(registry)).map(item => ({ ...item }));
                return { ...await namespace.profileNames(registry) };
            },
            ...(command.tool === 'tools_profile_profiles' ? { refresh: 'call' as const } : command.tool === 'tools_profile_commands' ? { refresh: 'revision' as const } : {}),
        } } : {}),
    });
}

