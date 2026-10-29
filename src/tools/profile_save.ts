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

