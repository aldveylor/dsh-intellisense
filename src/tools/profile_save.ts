import type { ProfileData } from '../registry/profile_tree.js';
import type { ProfileTreeNode } from '../registry/profile_node.js';
import { pluginCommands } from '../runtime/builtins.js';

/** @brief Report completion and unavailable discovery without rejecting or editing the saved Profile. */
export function profileSaveInformation(profile: ProfileData, tools: readonly string[], completed: boolean): string | null {
    const available = new Set(tools);
    const discovery = new Set([pluginCommands.discoveryCommand.path, pluginCommands.searchCommand.path]);
    let canDiscover = false;
    let incompletePins = false;
    const visit = (node: ProfileTreeNode, path: string): void => {
        if (node.disabled) return;
        if (node.type === 'command') {
            if (discovery.has(path)) canDiscover ||= available.has(node.command.tool);
            else if (node.fixedLevel !== 2) incompletePins = true;
            return;
        }
        for (const child of node.children ?? []) visit(child, path ? `${path}.${child.name}` : child.name);
    };
    visit(profile.root, '');
    const information: string[] = [];
    if (completed) information.push('`tools` namespace is completed.');
    if (!canDiscover && incompletePins) information.push('`inspect` and `search` are disabled when there are some commands not fixed with level 2.');
    return information.length ? information.join('\n') : null;
}
