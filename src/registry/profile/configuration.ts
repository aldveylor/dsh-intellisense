import { RegistryConfiguration, type RegistryConfigurationData } from '../configuration.js';
import { profileTree, ProfileSchema, type ProfileData } from '../profile_tree.js';
import type { ProfileTreeNode } from '../profile_node.js';
import { nodePermissions } from '../../namespace/node.js';
import type { NamespaceDefinitions } from '../../namespace/definitions.js';
import { validatePath } from '../path.js';
import { settingsAt, type ProfileNodeSettings } from './node_settings.js';

/** @brief Project a trusted recursive edit into storage, retaining permissions as a recursive tree. */
export function editedConfiguration(value: ProfileData, current: RegistryConfigurationData, definitions: NamespaceDefinitions): RegistryConfiguration {
    value = ProfileSchema.parse(value);
    if (value.root.disabled || value.root.fixedLevel || value.root.description) throw new Error('Anonymous Profile root only supports children and permissions');
    const result = new RegistryConfiguration({ ...current, brief: value.brief, mappings: [], namespaces: [], order: [], builtinVisible: {}, builtinDisabled: [], namespaceVisible: {}, nodeSettings: {} });
    const template = definitions.tree(value.name);
    const select = (node: ProfileTreeNode, defined?: ProfileTreeNode, ownedParent = false): ProfileTreeNode | undefined => {
        if (node.type === 'command') return ownedParent || defined?.command?.tool === node.command.tool ? structuredClone(node) : undefined;
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
        const defaults = nodePermissions(node.type === 'command' ? 'leaf' : 'tree');
        const overrides = Object.fromEntries(Object.entries(node.permissions ?? original?.permissions ?? {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
        if (Object.keys(overrides).length) settings.permissions = overrides;
        const previous = settingsAt(current.nodeSettings, path ? path.split('.') : []);
        if (previous?.description !== undefined) settings.description = previous.description;
        if (defined && path) {
            const description = node.type === 'namespace' ? node.description : node.command.doc;
            const oldDescription = original?.type === 'namespace' ? original.description : original?.command?.doc;
            if (description !== undefined && description !== oldDescription) settings.description = description;
        }
        const owned = defined?.type === node.type && (node.type !== 'command' || defined?.command?.tool === node.command.tool);
        if (node.type === 'command') {
            if (owned) {
                result.builtinVisible[path] = node.fixedLevel ?? 0;
                if (node.disabled) result.builtinDisabled.push(path);
            } else {
                const previous = current.mappings.find(mapping => mapping.id === node.command.tool && mapping.path === path);
                const description = node.command.doc === original?.command?.doc ? previous?.description : node.command.doc;
                result.mappings.push({ id: node.command.tool, path, pinned: previous?.pinned ?? false,
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
