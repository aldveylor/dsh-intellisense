import { defaultNamespaceDefinitions, type NamespaceDefinitions } from '../../namespace/definitions.js';
import { profileWrite } from '../profile_write.js';
import { compareProfile } from './compare.js';
import type { NamespaceTreeNode } from '../profile_node.js';

/** @brief Validate a target by applying its differences to typed root and child implementations. */
export function validateProfileEdit(before: NamespaceTreeNode, after: NamespaceTreeNode, definitions: NamespaceDefinitions = defaultNamespaceDefinitions): void {
    const snapshot = definitions.profile({ root: before });
    snapshot.apply(compareProfile(profileWrite({ name: '', root: before }), profileWrite({ name: '', root: after })));
}
