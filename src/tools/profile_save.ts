import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import type { ProfilePatch, ProfileWrite } from '../profile/catalog/profile_write.js';
import { ProfileWriteSchema, profileWrite } from '../profile/catalog/profile_write.js';
import { compareProfile } from '../profile/compare.js';
import { readProfile } from './profile_data.js';
import { applyProfile } from '../profile/edit.js';

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
    const service = sessions.namespace;
    const session = await sessions.addition(agent);
    const target = name ?? session.name;
    const commands = new Set((await sessions.commandBriefs(agent)).map(command => command.name));
    const initial = name === undefined || operation === 'save' ? session.profile.snapshot : undefined;
    let information: string | null = null;
    await service.edit(target, baseline => {
        const original = baseline.serialize();
        let snapshot = baseline;
        if (operation === 'save') {
            const value = ProfileWriteSchema.parse(input);
            const normalized = profileWrite({ name: target, brief: value.brief, root: snapshot.normalize(value.root) as ProfileData['root'] });
            snapshot = applyProfile(snapshot, compareProfile(profileWrite(readProfile(target, snapshot)), normalized) as ProfilePatch);
        } else snapshot = applyProfile(snapshot, input as ProfilePatch);
        snapshot.check({ commands, addition: tool => sessions.intellisense.toolAdditions.get(tool), owns: tool => sessions.owns(tool), original });
        information = profileSaveInformation(readProfile(target, snapshot), sessions.physical(agent).map(tool => tool.id));
        return snapshot;
    }, { initial, event: operation });
    return information;
}
