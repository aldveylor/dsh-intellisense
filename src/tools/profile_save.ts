import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import type { ProfileSaveEvent } from '../namespace/service.js';
import type { ProfilePatch, ProfileWrite } from '../registry/profile_write.js';
import { profileTree } from '../registry/profile_tree.js';
import { editedConfiguration } from '../registry/profile/configuration.js';
import { ProfileNotFoundError } from '../error.js';

import type { ProfileData } from '../registry/profile_tree.js';
import type { ProfileTreeNode } from '../registry/profile_node.js';
import { pluginCommands } from '../runtime/builtins.js';

/** @brief Report unavailable discovery without rejecting or editing the saved Profile. */
export function profileSaveInformation(profile: ProfileData, tools: readonly string[]): string | null {
    const available = new Set(tools);
    const discovery = pluginCommands.discoveryCommand.path;
    let canDiscover = false;
    let incompletePins = false;
    const visit = (node: ProfileTreeNode, path: string): void => {
        if (node.disabled) return;
        if (node.type === 'command') {
            if (path === discovery) canDiscover ||= available.has(node.command.tool);
            else if (node.fixedLevel !== 2) incompletePins = true;
            return;
        }
        for (const [name, child] of Object.entries(node.children ?? {})) visit(child, path ? `${path}.${name}` : name);
    };
    visit(profile.root, '');
    const information: string[] = [];
    if (!canDiscover && incompletePins) information.push('warning: `tools.inspect` is disabled when there are some enabled commands not fixed with level 2.');
    return information.length ? information.join('\n') : null;
}


/** @brief Validate save/apply in the tool layer, persist atomically and return validation information. */
export async function writeProfile(sessions: NamespaceIntegration, agent: Agent, name: string | undefined, input: ProfileWrite | ProfilePatch, operation: 'save' | 'apply'): Promise<string | null> {
    const namespace = sessions.namespace;
    const saved = await namespace.profileTransaction(async () => {
        const session = await sessions.registryFor(agent);
        const target = name ?? session.profileSelection().selected;
        const catalog = namespace.registry;
        const revision = catalog.revision;
        if (operation === 'apply' && name !== undefined && !catalog.profileSelection().profiles.includes(target)) throw new ProfileNotFoundError(target);
        const original = catalog.profileSelection().profiles.includes(target) ? catalog.configuration(target) : session.configuration();
        const source = operation === 'apply' && name === undefined ? session.configuration() : original;
        const baseline = catalog.definitions.profile(profileTree(target, original, catalog.definitions).save());
        const snapshot = catalog.definitions.profile(profileTree(target, source, catalog.definitions).save());
        if (operation === 'save') snapshot.save(input as ProfileWrite);
        else snapshot.apply(input as ProfilePatch);
        snapshot.check({ commands: new Set((await sessions.commandBriefs(agent)).map(command => command.name)),
            addition: tool => catalog.toolAdditions.get(tool), original: baseline.serialize() });
        const value = { name: target, brief: snapshot.brief, root: snapshot.serialize() };
        const information = profileSaveInformation(value, session.tools().map(tool => tool.id));
        const configuration = editedConfiguration(value, original, catalog.definitions);
        await catalog.saveProfile(target, configuration, { trusted: true, revision });
        agent.ctx.emit('system-prompt/change');
        const event: ProfileSaveEvent = Object.freeze({ name: target, time: new Date().toISOString(), type: operation });
        return { event, information };
    });
    await namespace.registry.definitions.processSave(saved.event);
    return saved.information;
}
