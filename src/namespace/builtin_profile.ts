import { pluginCommands, projectBuiltin, ptcToolName } from '../runtime/builtins.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import type { ToolsNamespace } from './service.js';

/** @brief Define plugin tools exclusively through the portable namespace registration API. */
export function registerBuiltinDefinitions(service: Pick<ToolsNamespace, 'setToolAddition'> & { registerProfileInitializer(initialize: (snapshot: ProfileSnapshot) => void): () => void }): void {
    for (const tool of ['exec', 'run_code', ptcToolName]) service.setToolAddition(tool, { hidden: true });
    for (const command of pluginCommands.builtinTools) service.setToolAddition(command.tool, { fixed: true, ptcDescription: projectBuiltin(command, 'ptc').description });
    service.registerProfileInitializer(configureBuiltinProfile);
}

/** @brief Construct builtin nodes through the same portable snapshot methods as external plugins. */
function configureBuiltinProfile(snapshot: ProfileSnapshot): ProfileSnapshot {

        const locked = { commentable: false, renamable: false, movable: false, removable: false };
        const tools = snapshot.getOrCreate('tools').setDescription('Tool discovery and Profile management')
            .setPermissions({ ...locked, acceptsChildren: false, availableFixLevels: [] });
        const management = tools.getOrCreate('profile').setDescription('Profile data and configuration')
            .setPermissions({ ...locked, acceptsChildren: false });
        for (const command of pluginCommands.builtinTools) {
            const parent = command.path.startsWith('tools.profile.') ? management : tools;
            const node = parent.getOrCreate(command.path.split('.').at(-1)!, 'command').setTool(command.tool).setPermissions(locked);
            if (command === pluginCommands.discoveryCommand) node.setPermissions({ availableFixLevels: [2] }).setFixedLevel(2);
        }
    return snapshot;
}

/** @brief Materialize builtin nodes using the public atomic Profile modification interface. */
export async function registerBuiltinProfile(service: ToolsNamespace, name: string): Promise<void> {
    await service.getOrCreate(name);
    await service.edit(name, configureBuiltinProfile);
}
