import type { ProfileSnapshot } from '../profile/profile.js';
import type { ProfileNode } from '../profile/node.js';
import type { ProfileNamespace } from '../profile/namespace.js';
import type { ProfileCommand } from '../profile/command.js';
import type { ProfileData } from '../profile/catalog/profile_tree.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../profile/catalog/profile_node.js';
import { nodePermissions } from '../profile/namespace/node.js';

/** @brief Build Agent JSON by traversing a detached snapshot, omitting default visibility and permissions. */
export function readProfile(name: string, snapshot: ProfileSnapshot): ProfileData {
    const visit = (node: ProfileNode): ProfileTreeNode => {
        const defaults = nodePermissions(node.type === 'command' ? 'leaf' : 'tree');
        const permissions = Object.fromEntries(Object.entries(node.permissions).filter(([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
        const settings = { ...(Object.keys(permissions).length ? { permissions } : {}), ...(node.fixedLevel ? { fixedLevel: node.fixedLevel } : {}), ...(node.disabled ? { disabled: true } : {}) };
        if (node.type === 'command') return { ...settings, type: 'command', command: structuredClone((node as ProfileCommand).serialize().command) } as ProfileTreeNode;
        const namespace = node as ProfileNamespace;
        return { ...settings, type: 'namespace', ...(namespace.description === undefined ? {} : { description: namespace.description }),
            children: Object.fromEntries([...namespace.children].map(([name, child]) => [name, visit(child)])) } as NamespaceTreeNode;
    };
    return { name, ...(snapshot.brief === undefined ? {} : { brief: snapshot.brief }), root: visit(snapshot) as NamespaceTreeNode };
}
