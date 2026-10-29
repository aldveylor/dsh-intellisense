import { PlaneProfile, type PlaneProfileData } from './profile.js';
import { profileTree, ProfileSchema, type ProfileData } from '../catalog/profile_tree.js';
import type { ProfileTreeNode } from '../catalog/profile_node.js';
import { nodePermissions } from '../namespace/node.js';
import { defaultNamespaceDefinitions, type NamespaceDefinitions } from '../namespace/definitions.js';
import { validatePath } from '../catalog/path.js';
import { settingsAt, type ProfileNodeSettings } from '../node_settings.js';
import type { ProfileSnapshot } from '../profile.js';

/** @brief Project a Profile snapshot or named transport tree into detached flat editor state, preserving supplied editor preferences. */
export function toPlaneProfile(profile: ProfileSnapshot | ProfileData, current: PlaneProfileData = new PlaneProfile(), definitions: NamespaceDefinitions = defaultNamespaceDefinitions): PlaneProfile {
    const value = ProfileSchema.parse('serialize' in profile ? { name: '', root: profile.serialize(), brief: profile.brief } : profile);
    if (value.root.disabled || value.root.fixedLevel || value.root.description) throw new Error('Anonymous Profile root only supports children and permissions');
    const result = new PlaneProfile({ ...current, brief: value.brief, mappings: [], namespaces: [], order: [], builtinVisible: {}, builtinDisabled: [], namespaceVisible: {}, nodeSettings: {} });
    const template = definitions.tree(value.name);
    const select = (node: ProfileTreeNode, defined?: ProfileTreeNode, ownedParent = false): ProfileTreeNode | undefined => {
        if (node.type === 'function') return ownedParent || defined?.function?.tool === node.function.tool ? structuredClone(node) : undefined;
        const owned = ownedParent || defined?.type === 'namespace';
        const children = Object.fromEntries(Object.entries(node.children ?? {}).flatMap(([name, child]) => {
            const selected = select(child, defined?.children?.[name], owned && !!defined?.children);
            return selected ? [[name, selected]] : [];
        }));
        return owned || Object.keys(children).length ? { ...structuredClone(node), children } : undefined;
    };
    const provided = { type: 'namespace' as const, children: Object.fromEntries(Object.entries(value.root.children ?? {}).flatMap(([name, child]) => {
        const selected = select(child, template.children?.[name]);
        return selected ? [[name, selected]] : [];
    })) };
    const clearDisabled = (node: ProfileTreeNode): void => {
        delete node.disabled;
        for (const child of Object.values(node.children ?? {})) clearDisabled(child);
    };
    clearDisabled(provided);
    result.providedRoot = provided;
    const baseline = profileTree(value.name, current, definitions).root;
    const visit = (node: ProfileTreeNode, path: string, settings: ProfileNodeSettings, defined?: ProfileTreeNode, original?: ProfileTreeNode): void => {
        if (path && !defined) validatePath(node.type === 'namespace' ? `${path}.namespace_check` : path);
        const defaults = nodePermissions(node.type === 'function' ? 'leaf' : 'tree');
        const overrides = Object.fromEntries(Object.entries(node.permissions ?? original?.permissions ?? {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
        if (Object.keys(overrides).length) settings.permissions = overrides;
        const previous = settingsAt(current.nodeSettings, path ? path.split('.') : []);
        if (previous?.description !== undefined) settings.description = previous.description;
        if (defined && path) {
            const description = node.type === 'namespace' ? node.description : node.function.doc;
            const oldDescription = original?.type === 'namespace' ? original.description : original?.function?.doc;
            if (description !== undefined && description !== oldDescription) settings.description = description;
        }
        const owned = defined?.type === node.type && (node.type !== 'function' || defined?.function?.tool === node.function.tool);
        if (node.type === 'function') {
            if (owned) {
                result.builtinVisible[path] = node.fixedLevel ?? 0;
                if (node.disabled) result.builtinDisabled.push(path);
            } else {
                const previous = current.mappings.find(mapping => mapping.id === node.function.tool && mapping.path === path);
                const description = node.function.doc === original?.function?.doc ? previous?.description : node.function.doc;
                result.mappings.push({ id: node.function.tool, path, pinned: previous?.pinned ?? false,
                    ...(description === undefined ? {} : { description }),
                    ...(node.fixedLevel || previous?.alwaysVisible !== undefined ? { alwaysVisible: node.fixedLevel ?? 0 } : {}),
                    ...(node.disabled || previous?.disabled !== undefined ? { disabled: node.disabled ?? false } : {}),
                });
            }
            return;
        }
        if (path) {
            if (owned) {
                result.namespaceVisible[path] = !!node.fixedLevel;
                if (node.disabled) result.builtinDisabled.push(path);
            } else result.namespaces.push({ path, description: node.description ?? '', alwaysVisible: !!node.fixedLevel, ...(node.disabled === undefined ? {} : { disabled: node.disabled }) });
        }
        for (const [name, child] of Object.entries(node.children ?? {})) {
            const childSettings: ProfileNodeSettings = {};
            const childPath = path ? `${path}.${name}` : name;
            result.order.push(childPath);
            visit(child, childPath, childSettings, defined?.children?.[name], original?.children?.[name]);
            if (Object.keys(childSettings).length) (settings.children ??= {})[name] = childSettings;
        }
    };
    visit(value.root, '', result.nodeSettings, provided, baseline);
    return result;
}
