import type { Mapping, PhysicalTool, PinLevel, CommandVisibility } from '../../registry/registry.js';
import { fixLevel, type Permission, type SerializedNode } from '../../integration/node.js';

/** @brief Client command metadata comes entirely from the server's node description. */
export interface ProvidedCommand {
    path: string; id?: string; signature?: string; description: string;
    permissions: Permission; alwaysVisible: PinLevel; disabled?: boolean;
    node: SerializedNode;
}

/** @brief A protected subtree is projected without client knowledge of its names or server classes. */
export interface ProvidedNamespace { path: string; description: string; permissions: Permission; commands: ProvidedCommand[]; children?: ProvidedNamespace[]; node: SerializedNode }

/** @brief List physical tools that have neither a mapping nor a server-owned node. */
export function unmountedTools(tools: PhysicalTool[], mappings: Mapping[], provided: readonly ProvidedNamespace[] = []): PhysicalTool[] {
    const mounted = new Set(mappings.filter(mapping => mapping.path.trim()).map(mapping => mapping.id));
    const visit = (namespace: ProvidedNamespace): void => {
        for (const command of namespace.commands) if (command.id) mounted.add(command.id);
        for (const child of namespace.children ?? []) visit(child);
    };
    provided.forEach(visit);
    return tools.filter(tool => !mounted.has(tool.id));
}

/** @brief Convert serialized tree/leaf descriptions into view contracts and apply the local draft. */
export function TreeProvider(nodes: readonly SerializedNode[], visible: CommandVisibility = {}): ProvidedNamespace[] {
    const visit = (node: SerializedNode, parent: string): ProvidedNamespace => {
        const path = parent ? `${parent}.${node.name}` : node.name;
        return { path, description: node.description ?? '', permissions: node.permissions, node,
            commands: (node.children ?? []).filter(child => child.type === 'leaf').map(child => ({ path: `${path}.${child.name}`, id: child.deployment === 'tool' ? child.command?.tool : undefined,
                signature: child.signature, description: child.description ?? child.command?.doc ?? '', permissions: child.permissions,
                alwaysVisible: fixLevel(child.permissions, visible[`${path}.${child.name}`] ?? 0), node: child })),
            children: (node.children ?? []).filter(child => child.type === 'tree').map(child => visit(child, path)) };
    };
    return nodes.filter(node => node.type === 'tree').map(node => visit(node, ''));
}

/** @brief Resolve a server-described namespace or its descendants without any reserved-name table. */
export function providedNamespace(path: string, roots: readonly ProvidedNamespace[] = []): ProvidedNamespace | undefined {
    for (const node of roots) {
        const child = providedNamespace(path, node.children ?? []);
        if (child) return child;
        if (path === node.path || path.startsWith(`${node.path}.`)) return node;
    }
}
