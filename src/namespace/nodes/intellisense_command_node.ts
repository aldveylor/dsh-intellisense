import { InnerCommandNode } from './inner_command_node.js';
import type { NamespaceNode } from './node.js';
import type { ManifestEntry } from '../namespace.js';
import { pluginCommands } from '../../runtime/builtins.js';

/** @brief Discovery owns its detailed pin policy while allowing disablement. */
export class IntellisenseCommandNode extends InnerCommandNode {
    constructor(parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>) {
        super('intellisense', parent, entry, pluginCommands.discoveryCommand, { availableFixLevels: [2] });
    }
}

