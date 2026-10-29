import { pluginCommands, projectBuiltin, ptcToolName } from '../runtime/builtins.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import type { ToolsNamespace, ProfileSaveEvent } from './service.js';
import { profileAnnotation } from '../registry/profile_tree.js';
import { profileSaveInformation } from '../tools/profile_save.js';
import type { ProfileNamespace } from '../registry/profile/namespace.js';

/** @brief Define plugin tools exclusively through the portable namespace registration API. */
export function registerBuiltinDefinitions(service: Pick<ToolsNamespace, 'setToolAddition' | 'effect'> & { registerProfileInitializer(initialize: (snapshot: ProfileSnapshot) => void): () => void }): void {
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
            read: async (namespace, agent, registry) => {
                if (command.tool === 'tools_profile_annotation') return profileAnnotation;
                if (command.tool === 'tools_profile_commands') return (await namespace.commandBriefs(agent, registry)).map(item => ({ ...item }));
                return { ...await namespace.profileNames(agent, registry) };
            },
            ...(command.tool === 'tools_profile_profiles' ? { refresh: 'call' as const } : command.tool === 'tools_profile_commands' ? { refresh: 'revision' as const } : {}),
        } } : {}),
    });
    service.registerProfileInitializer(configureBuiltinProfile);
    service.effect('save', repairBuiltinSave);
}

/** @brief Construct builtin nodes through the same portable snapshot methods as external plugins. */
function configureBuiltinProfile(snapshot: ProfileSnapshot): ProfileSnapshot {
    const locked = { commentable: false, renamable: false, movable: false, removable: false };
    const namespace = (parent: ProfileNamespace, name: string): ProfileNamespace => {
        if (parent.get(name)?.type === 'command') parent.remove(name);
        return parent.getOrCreate(name);
    };
    const tools = namespace(snapshot, 'tools').setDescription('Tool discovery and Profile management')
        .setPermissions({ ...locked, acceptsChildren: false, availableFixLevels: [] }).setFixedLevel(0);
    const management = namespace(tools, 'profile').setDescription('Profile data and configuration')
        .setPermissions({ ...locked, acceptsChildren: false });
    for (const command of pluginCommands.builtinTools) {
        const parent = command.path.startsWith('tools.profile.') ? management : tools;
        const name = command.path.split('.').at(-1)!;
        if (parent.get(name)?.type === 'namespace') parent.remove(name);
        const node = parent.getOrCreate(name, 'command').setTool(command.tool).setPermissions(locked);
        if (command === pluginCommands.discoveryCommand) node.setPermissions({ availableFixLevels: [2] }).setFixedLevel(2);
    }
    return snapshot;
}

/** @brief Restore provider-owned structure and fixed values within the shared save transaction. */
function repairBuiltinSave(event: ProfileSaveEvent): void {
    const submittedTools = event.profile.serialize().children?.tools;
    configureBuiltinProfile(event.baseline);
    configureBuiltinProfile(event.profile);
    const baseline = event.baseline.serialize();
    for (const command of pluginCommands.builtinTools) {
        const parts = command.path.split('.');
        let original = baseline;
        let parent: ProfileNamespace = event.profile;
        for (const name of parts.slice(0, -1)) {
            original = original.children![name]! as typeof original;
            parent = parent.get(name, 'namespace')!;
        }
        const name = parts.at(-1)!;
        const description = original.children![name]!.command!.doc;
        if (description !== undefined) parent.get(name, 'command')!.setDescription(description);
    }
    if (event.operation === 'save') event.profile.get('tools')!.setDisabled(submittedTools?.disabled !== false);
    const information = profileSaveInformation({ name: event.name, root: event.profile.serialize() }, event.tools);
    if (information) event.result = [event.result, information].filter(Boolean).join('\n');
}

/** @brief Materialize builtin nodes using the public atomic Profile modification interface. */
export async function registerBuiltinProfile(service: ToolsNamespace, name: string): Promise<void> {
    await service.getOrCreate(name);
    await service.edit(name, configureBuiltinProfile);
}
