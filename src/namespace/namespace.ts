import { NamespaceNode } from './nodes/node.js';
import { CommandNode } from './nodes/command_node.js';
import { ToolsNamespaceNode } from './nodes/tools_namespace_node.js';
import { ConsoleNamespaceNode } from './nodes/console_namespace_node.js';
import type { NamespaceContext } from './nodes/context.js';
import { commandDeclaration } from './nodes/command_contract.js';
export { nativeArgumentsFor, nativeSchema, resultFor } from './nodes/command_contract.js';
export { NamespaceNode } from './nodes/node.js';
export { CommandNode } from './nodes/command_node.js';
export { InnerNamespaceNode } from './nodes/inner_namespace_node.js';
export { InnerCommandNode } from './nodes/inner_command_node.js';
export { EnvironmentCommandNode } from './nodes/environment_command_node.js';
export { ConsoleNamespaceNode } from './nodes/console_namespace_node.js';
export { ToolsNamespaceNode } from './nodes/tools_namespace_node.js';
export { ProfileNamespaceNode } from './nodes/profile_namespace_node.js';
export { IntellisenseCommandNode } from './nodes/intellisense_command_node.js';
export type { NamespaceContext } from './nodes/context.js';
import { nodePermissions, type CommandContract } from './node.js';
export type { Node, NodeType, Permission, SerializedNode } from './node.js';
import { namespaceDeclaration } from './declaration.js';
import { z } from 'zod';
import { pluginCommands, reservedToolIds } from '../runtime/builtins.js';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief YAML aliases reference physical tools and rename argument fields without reimplementing tools. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1), argMap: z.record(z.string(), z.string()).optional() })).superRefine((aliases, context) => {
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
    const root = new NamespaceNode('', undefined, '', nodePermissions('tree', { renamable: false, movable: false, removable: false, disableable: false, availableFixLevels: [] }));
    root.add(new ConsoleNamespaceNode(root, context));
    root.add(new ToolsNamespaceNode(root, context));
    return root;
}

/** @brief Ignore the ambient global namespace prefix and validate discovery paths. */
export function normalizeIntellisenseQueries(queries: readonly string[]): string[] {
    return queries.map(query => {
        const path = query.replace(/^global\./, '');
        if (path !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(path)) throw new Error(`Invalid IntelliSense query: ${query}`);
        return path;
    });
}

/** @brief Select exact commands or direct members by following the node chain. */
export function queryNodes(root: NamespaceNode, queries: readonly string[]): (NamespaceNode | CommandNode)[] {
    const selected = new Set<NamespaceNode | CommandNode>();
    for (const query of normalizeIntellisenseQueries(queries)) {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path ? path.split('.') : []);
        if (!node || node.disabled) continue;
        if (node instanceof NamespaceNode) for (const child of node.children.values()) { if (!child.disabled) selected.add(child); }
        else if (node && !query.endsWith('.')) selected.add(node);
    }
    return [...selected];
}

/** @brief Build deterministic, scoped aliases from the current Profile and physical tool catalog. */
export function manifest(registry: SemanticRegistry, aliases: z.infer<typeof Aliases>): NamespaceNode {
    const root = createNamespace({ tools: registry.tools(), disabled: path => registry.disabled(path) });
    const descriptions = new Map(registry.snapshot().namespaces?.map(item => [item.path, item.description]));
    const insert = (entry: ManifestEntry): void => {
        if (registry.disabled(entry.path)) return;
        const parts = entry.path.split('.');
        if (parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part)) || parts[0] === 'globalThis') throw new Error(`Reserved manifest path: ${entry.path}`);
        let parent: NamespaceNode = root;
        for (const name of parts.slice(0, -1)) {
            const existing = parent.children.get(name);
            if (existing && !(existing instanceof NamespaceNode)) throw new Error(`Namespace overlaps a callable path: ${entry.path}`);
            if (existing && !existing.permissions.acceptsChildren) throw new Error(`Namespace does not accept mappings: ${entry.path}`);
            parent = existing ?? parent.add(new NamespaceNode(name, parent, descriptions.get(parent.path ? `${parent.path}.${name}` : name) ?? ''));
        }
        const name = parts.at(-1)!;
        const previous = parent.children.get(name);
        if (previous) {
            if (previous instanceof CommandNode && previous.tool === entry.tool) return;
            throw new Error(`Conflicting tool alias: ${entry.path}`);
        }
        parent.add(new CommandNode(name, parent, entry));
    };
    const effective = registry.effective().filter(mapping => !mapping.disabled && !pluginCommands.find(mapping.id) && !reservedToolIds.includes(mapping.id));
    for (const mapping of effective) {
        for (const path of [mapping.path, ...mapping.aliases]) {
            // Unmounted physical tools are not synthesized below the protected tools namespace.
            if (path.startsWith('tools.')) continue;
            insert({ path, tool: mapping.id, schema: mapping.tool.parameters, output: mapping.tool.output, doc: mapping.tool.description });
        }
    }
    const mounted = new Set(effective.map(mapping => mapping.id));
    for (const alias of aliases) {
        const tool = registry.tools().find(tool => tool.id === alias.tool);
        if (tool && mounted.has(tool.id)) insert({ ...alias, schema: tool.parameters, output: tool.output, doc: tool.description });
    }
    return root;
}


/** @brief Emit positional signatures and scalar results with decoded Doxygen parameter documentation. */
export function declaration(entry: ManifestEntry, nested = true): string {
    if (entry instanceof CommandNode) return entry.declaration(nested);
    return namespaceDeclaration([{ path: nested ? entry.path : entry.path.split('.').at(-1)!, declaration: commandDeclaration(entry) }], false);
}

