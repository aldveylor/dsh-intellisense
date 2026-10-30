import { EditableNamespace, isProfileMemberName, type ProfileNamespace } from '../namespace.js';
import { EditableFunction } from '../function.js';
import type { ProfileNode } from '../node.js';
import type { ProfileSnapshot } from '../profile.js';
import type { NamespaceTreeNode, ProfileTreeNode } from './profile_node.js';
import { ProfileSchema, type ProfileData } from './profile_tree.js';

/** @brief Recover independently loadable members using the current concrete node policies. */
export function recoverProfile(data: Pick<ProfileData, 'root' | 'brief'>, initial: ProfileSnapshot): Pick<ProfileData, 'root' | 'brief'> {
    const root = recoverNode(data.root, initial).serialize() as NamespaceTreeNode;
    return { root, ...(typeof data.brief === 'string' ? { brief: data.brief } : {}) };
}

/** @brief Drop invalid members and obsolete closed-namespace keys while restoring required defaults. */
function recoverNode(value: unknown, initial?: ProfileNode): ProfileNode {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Profile node');
    const data = value as ProfileTreeNode;
    if (data.type !== 'namespace' && data.type !== 'function') throw new Error('Invalid Profile node type');
    const template = initial ?? (data.type === 'namespace' ? new EditableNamespace() : new EditableFunction());
    const candidate = { ...data, ...(data.type === 'namespace' ? { children: {} } : {}) } as ProfileTreeNode;
    const validation = ProfileSchema.safeParse({ name: 'Recovery', root: { type: 'namespace', children: { entry: candidate } } });
    let node = template.copyNode(validation.success ? candidate : template.serialize());
    if (data.type === 'namespace' && node.type === 'namespace') {
        const namespace = node as ProfileNamespace;
        const children = data.children && typeof data.children === 'object' && !Array.isArray(data.children) ? data.children : {};
        const recovered = Object.fromEntries(Object.entries(children).flatMap(([name, child]) => {
            if (!isProfileMemberName(name)) return [];
            const declared = namespace.get(name);
            if (!declared && !namespace.permissions.acceptsChildren) return [];
            try { return [[name, recoverNode(child, declared).serialize()]]; }
            catch { return []; }
        }));
        node = namespace.copyNode({ ...namespace.serialize(), children: recovered });
    }
    return node;
}
