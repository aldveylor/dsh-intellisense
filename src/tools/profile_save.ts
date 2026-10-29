import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import type { ProfileSaveEvent } from '../profile/service.js';
import type { ProfilePatch, ProfileWrite } from '../profile/catalog/profile_write.js';
import { PlaneProfile } from '../profile/plane/profile.js';
import { toPlaneProfile } from '../profile/plane/to_plane_profile.js';
import { ProfileNotFoundError } from '../error.js';

import type { ProfileData } from '../profile/catalog/profile_tree.js';
import type { ProfileTreeNode } from '../profile/catalog/profile_node.js';
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
        const session = await sessions.addition(agent);
        const target = name ?? session.name;
        const catalog = namespace.registry;
        const revision = catalog.revision;
        const exists = catalog.profileSelection().profiles.includes(target);
        if (operation === 'apply' && name !== undefined && !exists) throw new ProfileNotFoundError(target);
        const baseline = exists ? (await catalog.reference(target)).snapshot : session.profile.snapshot;
        const snapshot = baseline.clone();
        if (operation === 'save') snapshot.save(input as ProfileWrite);
        else snapshot.apply(input as ProfilePatch);
        snapshot.check({ commands: new Set((await sessions.commandBriefs(agent)).map(command => command.name)),
            addition: tool => sessions.intellisense.toolAdditions.get(tool), owns: tool => catalog.owns(tool), original: baseline.serialize() });
        const value = { name: target, brief: snapshot.brief, root: snapshot.serialize() };
        const information = profileSaveInformation(value, sessions.physical(agent).map(tool => tool.id));
        const configuration = toPlaneProfile(value, exists ? catalog.configuration(target) : new PlaneProfile(), catalog.definitions);
        await catalog.saveProfile(target, configuration, { trusted: true, revision });
        agent.ctx.emit('system-prompt/change');
        const event: ProfileSaveEvent = Object.freeze({ name: target, time: new Date().toISOString(), type: operation });
        return { event, information };
    });
    await namespace.registry.definitions.processSave(saved.event);
    return saved.information;
}
