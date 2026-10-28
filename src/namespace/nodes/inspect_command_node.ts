import { InnerCommandNode } from './inner_command_node.js';
import type { NamespaceNode } from './node.js';
import type { ManifestEntry } from '../namespace.js';
import { pluginCommands, projectBuiltin, type BuiltinCommand } from '../../runtime/builtins.js';

/** @brief Discovery owns its detailed pin policy while allowing disablement. */
export class InspectCommandNode extends InnerCommandNode {
    constructor(parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, builtin: BuiltinCommand = projectBuiltin(pluginCommands.discoveryCommand, 'ptc')) {
        super('inspect', parent, entry, builtin, { availableFixLevels: [2] });
    }
}

