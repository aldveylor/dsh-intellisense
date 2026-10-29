import { defaultNamespaceDefinitions, type NamespaceDefinitions } from './namespace/definitions.js';
import { profileWrite } from './catalog/profile_write.js';
import { applyProfile } from './edit.js';
import { compareProfile } from './compare.js';
import type { NamespaceTreeNode } from './catalog/profile_node.js';

/** @brief Validate a target by applying its differences to typed root and child implementations. */
export function validateProfileEdit(before: NamespaceTreeNode, after: NamespaceTreeNode, definitions: NamespaceDefinitions = defaultNamespaceDefinitions): void {
    const snapshot = definitions.profile({ root: before });
    applyProfile(snapshot, compareProfile(profileWrite({ name: '', root: before }), profileWrite({ name: '', root: after })));
}
