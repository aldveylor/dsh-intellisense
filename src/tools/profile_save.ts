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
    if (!canDiscover && incompletePins) information.push('warning: `inspect` is disabled when there are some commands not fixed with level 2.');
    return information.length ? information.join('\n') : null;
}

/** @brief Recursively merge object fields, delete null fields and replace arrays and scalar values. */
export function mergeProfilePatch(target: unknown, patch: Record<string, unknown>): Record<string, unknown> {
    const fields = new Map<string, unknown>(target !== null && typeof target === 'object' && !Array.isArray(target) ? Object.entries(target) : []);
    for (const [key, value] of Object.entries(patch)) {
        if (!/^[A-Za-z_][\w$]*$/.test(key) || Object.hasOwn(Object.prototype, key) || ['prototype', 'then'].includes(key) || key.startsWith('__')) throw new Error(`Invalid or reserved Profile patch key: ${key}`);
        if (value === null) fields.delete(key);
        else fields.set(key, typeof value === 'object' && !Array.isArray(value) ? mergeProfilePatch(fields.get(key), value as Record<string, unknown>) : value);
    }
    return Object.fromEntries(fields);
}
