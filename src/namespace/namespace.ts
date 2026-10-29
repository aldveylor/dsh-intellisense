import { profileTree } from '../registry/profile_tree.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import { EditableNamespace } from '../registry/profile/namespace.js';
import { EditableCommand } from '../registry/profile/command.js';
import type { ProfileCommand } from '../registry/profile/command.js';
import type { ProfileNamespace } from '../registry/profile/namespace.js';
import type { PresentationMode } from '../integration/presentation.js';
import { NamespaceNode } from './nodes/node.js';
import { CommandNode } from './nodes/command_node.js';
import { DefinedNamespaceNode } from './nodes/defined_namespace_node.js';
import { defaultNamespaceDefinitions } from './definitions.js';
import { permissionsAt, settingsAt } from '../registry/profile/node_settings.js';
import type { ProfileTreeNode } from '../registry/profile_node.js';
import type { NamespaceContext, NamespaceInitialization } from './nodes/context.js';
import { commandDeclaration } from './nodes/command_contract.js';
export { nativeArgumentsFor, resultFor } from './nodes/command_contract.js';
export { NamespaceNode } from './nodes/node.js';
export { CommandNode } from './nodes/command_node.js';
export type { NamespaceContext } from './nodes/context.js';
import { nodePermissions, type CommandContract } from './node.js';
export type { Node, NodeType, Permission, SerializedNode } from './node.js';
import { namespaceDeclaration } from './declaration.js';
import { z } from 'zod';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief YAML aliases mount physical tools at additional namespace paths. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1) })).superRefine((aliases, context) => {
    const names = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
        const parts = alias.path.split('.');
        if (['console', 'tools', 'globalThis'].includes(parts[0]!) || parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part))) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Reserved alias path' });
        if (names.has(alias.path)) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Duplicate alias path' });
        names.add(alias.path);
    }
});

/** @brief Trusted host-side namespace manifest entry. */
export interface ManifestEntry extends CommandContract { path: string }

/** @brief Create an ordinary root container with server-owned protected children before adding mappings. */
export function createNamespace(context: NamespaceContext): NamespaceNode {
    const root = new NamespaceNode('', undefined, '', nodePermissions('tree', { renamable: false, commentable: false, movable: false, removable: false, disableable: false, availableFixLevels: [] }));
    const definitions = context.definitions ?? defaultNamespaceDefinitions.tree();
    const additionFor = context.addition ?? (tool => defaultNamespaceDefinitions.addition(tool));
    const discoverable = (node: ProfileTreeNode, path: string, disabled = false): boolean => {
        disabled ||= !!node.disabled || !!context.disabled?.(path);
        if (disabled) return false;
        if (node.type === 'command') return !!additionFor(node.command.tool).discovery && !additionFor(node.command.tool).hidden
            && (!!context.includeUnavailable || context.tools.some(tool => tool.id === node.command.tool));
        return Object.entries(node.children ?? {}).some(([name, child]) => discoverable(child, path ? `${path}.${name}` : name, disabled));
    };
    const discoveryAvailable = discoverable(definitions, '');
    const build = (name: string, data: ProfileTreeNode, parent: NamespaceNode): NamespaceNode | CommandNode | undefined => {
        const path = parent.path ? `${parent.path}.${name}` : name;
        const permissions = nodePermissions(data.type === 'namespace' ? 'tree' : 'leaf', { ...data.permissions, ...permissionsAt(context.nodeSettings, path.split('.')) });
        if (data.type === 'namespace') {
            const options: NamespaceInitialization = { name, parent, description: settingsAt(context.nodeSettings, path.split('.'))?.description ?? data.description ?? '', permissions,
                disabled: context.disabled?.(path) ?? !!data.disabled, fixedLevel: data.fixedLevel ?? 0,
                children: node => Object.entries(data.children ?? {}).flatMap(([name, child]) => build(name, child, node) ?? []) };
            const implementation = (context.implementation ?? (path => defaultNamespaceDefinitions.implementation(path)))(path);
            return implementation ? implementation(options) : new DefinedNamespaceNode(options.name, options.parent, options.description, options.permissions, options.disabled, options.fixedLevel, options.children);
        }
        if (context.disabled?.(path) || data.disabled || (context.addition ?? (tool => defaultNamespaceDefinitions.addition(tool)))(data.command.tool).hidden) return undefined;
        const tool = context.tools.find(tool => tool.id === data.command.tool);
        if (!tool && !context.includeUnavailable) return undefined;
        const addition = additionFor(data.command.tool);
        const projected = addition.project?.(tool?.parameters ?? {}, context.mode ?? 'ptc', discoveryAvailable);
        const doc = context.mode !== 'native' ? addition.ptcDescription ?? projected?.description ?? tool?.description ?? data.command.doc ?? ''
            : projected?.description ?? tool?.description ?? data.command.doc ?? '';
        const entry = { tool: data.command.tool, schema: tool?.parameters ?? {}, output: tool?.output, doc, presentation: projected };
        return new CommandNode(name, parent, entry, permissions, data.fixedLevel, context.provided?.(path) ?? true);
    };
    for (const [name, data] of Object.entries(definitions.children ?? {})) {
        const node = build(name, data, root);
        if (node) root.add(node);
    }
    Object.assign(root.permissions, context.nodeSettings?.permissions);
    return root;
}

/** @brief Ignore the ambient global namespace prefix and validate discovery paths. */
export function normalizeInspectQueries(queries: readonly string[]): string[] {
    return queries.map(query => {
        const path = query.replace(/^global\./, '');
        if (path !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(path)) throw new Error(`Invalid Inspect query: ${query}`);
        return path;
    });
}

/** @brief Select exact commands or direct members by following the node chain. */
export function queryNodes(root: NamespaceNode, queries: readonly string[]): (NamespaceNode | CommandNode)[] {
    const selected = new Set<NamespaceNode | CommandNode>();
    for (const query of normalizeInspectQueries(queries)) {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path ? path.split('.') : []);
        if (!node || node.disabled) continue;
        if (node instanceof NamespaceNode) for (const child of node.children.values()) { if (!child.disabled) selected.add(child); }
        else if (node && !query.endsWith('.')) selected.add(node);
    }
    return [...selected];
}

/** @brief Build deterministic, scoped aliases from the current Profile and physical tool catalog. */
export function manifest(registry: SemanticRegistry, aliases: z.infer<typeof Aliases>, mode: PresentationMode = 'ptc', profile?: ProfileSnapshot): NamespaceNode {
    const tools = registry.tools();
    const byId = new Map(tools.map(tool => [tool.id, tool]));
    const state = registry.snapshot();
    profile ??= registry.definitions.profile(profileTree(state.profile ?? 'Default', registry.configuration(), registry.definitions).save());
    const template = state.providedRoot ?? registry.definitions.tree(state.profile);
    const definition = new EditableNamespace('', profile.serialize());
    const nodeFor = (parts: string[]): ProfileNamespace => parts.reduce((parent, name) => {
        const node = parent.getOrCreate(name, () => new EditableNamespace(name));
        if (node.type !== 'namespace') throw new Error(`Expected namespace: ${name}`);
        return node as ProfileNamespace;
    }, definition as ProfileNamespace);
    for (const item of state.namespaces ?? []) nodeFor(item.path.split('.')).setDescription(item.description);
    const insert = (path: string, tool: string): void => {
        const parts = path.split('.');
        const parent = nodeFor(parts.slice(0, -1));
        const name = parts.at(-1)!;
        const previous = parent.get(name);
        if (previous) {
            if (previous.type === 'command' && (previous as ProfileCommand).tool === tool) return;
            throw new Error(`Conflicting tool alias: ${path}`);
        }
        const node = parent.create(name, () => new EditableCommand(name));
        if (node.type !== 'command') throw new Error(`Expected command: ${name}`);
        (node as ProfileCommand).setTool(tool);
    };
    const effective = registry.effective().filter(mapping => !mapping.disabled && !registry.definitions.addition(mapping.id).hidden);
    for (const mapping of effective) {
        // Unmounted tools have no namespace mount until a plugin or Profile adds one.
        if (!state.mappings.some(saved => saved.path === mapping.path && saved.id === mapping.id)) continue;
        const node = profile.resolve(mapping.path);
        const tool = node?.type === 'command' ? (node as ProfileCommand).tool : undefined;
        if (tool) insert(mapping.path, tool);
    }
    const mounted = new Set(effective.map(mapping => mapping.id));
    for (const alias of aliases) if (byId.has(alias.tool) && mounted.has(alias.tool)) insert(alias.path, alias.tool);
    const provided = (path: string): boolean => {
        let node: ProfileTreeNode | undefined = template;
        for (const name of path.split('.')) node = node?.children?.[name];
        return node !== undefined;
    };
    return createNamespace({ tools, mode, definitions: definition.serialize(), nodeSettings: state.nodeSettings,
        addition: tool => registry.definitions.addition(tool), implementation: path => registry.definitions.implementation(path), disabled: path => registry.disabled(path), provided });
}


/** @brief Emit positional signatures and scalar results with decoded Doxygen parameter documentation. */
export function declaration(entry: ManifestEntry, nested = true): string {
    if (entry instanceof CommandNode) return entry.declaration(nested);
    return namespaceDeclaration([{ path: nested ? entry.path : entry.path.split('.').at(-1)!, declaration: commandDeclaration(entry) }], false);
}

