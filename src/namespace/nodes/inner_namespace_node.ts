import { nodePermissions, type Permission } from '../node.js';
import { NamespaceNode } from './namespace_node.js';

/** @brief Restricted namespaces own their children and reject external structural edits. */
export class InnerNamespaceNode extends NamespaceNode {
    constructor(name: string, parent: NamespaceNode, description = '', permissions: Partial<Permission> = {}, disabled = false) {
        super(name, parent, description, nodePermissions('tree', { renamable: false, movable: false, removable: false, acceptsChildren: false, availableFixLevels: [], ...permissions }), disabled);
    }
}

