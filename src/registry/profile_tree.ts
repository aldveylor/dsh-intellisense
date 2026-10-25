import { z } from 'zod';
import type { RegistryConfiguration } from './registry.js';
import { CommandNode, NamespaceNode, createNamespace } from '../integration/namespace.js';
import { fixLevel, type SerializedNode } from '../integration/node.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Original command summary, independent of its mounted path. */
export interface CommandBrief { name: CommandName; brief: string }

/** @brief Profiles expose the same serialized tree/leaf node description as management clients. */
export interface Profile { name: string; root: SerializedNode }

/** @brief Validate shared permissions without trusting them as the server's authority. */
const permissionSchema = z.strictObject({ renamable: z.boolean(), movable: z.boolean(), removable: z.boolean(), disableable: z.boolean(), acceptsChildren: z.boolean(), availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])) });

/** @brief Recursive transport schema for both editable and protected Profile nodes. */
const nodeSchema: z.ZodType<SerializedNode> = z.lazy(() => z.strictObject({
    type: z.enum(['tree', 'leaf']), name: z.string(), permissions: permissionSchema,
    children: z.array(nodeSchema).optional(),
    command: z.strictObject({ tool: z.string(), argMap: z.record(z.string(), z.string()).optional(), schema: z.record(z.string(), z.unknown()), output: z.unknown().optional(), doc: z.string() }).optional(),
    description: z.string().optional(), signature: z.string().optional(), deployment: z.enum(['tool', 'environment']).optional(), preload: z.boolean().optional(),
    fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(), disabled: z.boolean().optional(),
}));

/** @brief Validate complete editable Profile input before applying server-owned node policies. */
export const ProfileSchema: z.ZodType<Profile> = z.strictObject({ name: z.string(), root: nodeSchema });

/** @brief Create protected children first, then add configured mappings without replacing existing nodes. */
export function profileTree(name: string, configuration: RegistryConfiguration): Profile {
    const root = createNamespace({ tools: [], includeUnavailable: true });
    const nodeFor = (path: string): NamespaceNode => {
        const parts = path.split('.').filter(Boolean);
        const parent = parts.length > 1 ? nodeFor(parts.slice(0, -1).join('.')) : root;
        if (!parts.length) return root;
        const child = parent.children.get(parts.at(-1)!);
        if (child instanceof NamespaceNode) return child;
        if (child) throw new Error(`Namespace collides with command: ${path}`);
        return parent.add(new NamespaceNode(parts.at(-1)!, parent, configuration.namespaces.find(item => item.path === path)?.description));
    };
    for (const item of configuration.namespaces) nodeFor(item.path);
    for (const mapping of configuration.mappings) for (const path of [mapping.path, ...mapping.aliases]) {
        const parts = path.split('.');
        nodeFor(parts.slice(0, -1).join('.')).add(new CommandNode(parts.at(-1)!, nodeFor(parts.slice(0, -1).join('.')), { tool: mapping.id, schema: {}, output: {}, doc: configuration.toolComments?.[mapping.id] ?? mapping.description ?? '' }));
    }
    const snapshot = root.serialize();
    const apply = (node: SerializedNode, prefix: string): void => {
        const path = prefix ? `${prefix}.${node.name}` : node.name;
        const mapping = configuration.mappings.find(item => [item.path, ...item.aliases].includes(path));
        const namespace = configuration.namespaces.find(item => item.path === path);
        node.fixedLevel = fixLevel(node.permissions, node.type === 'leaf' ? configuration.builtinVisible?.[path] ?? mapping?.alwaysVisible ?? 0
            : namespace?.alwaysVisible || configuration.namespaceVisible?.[path] ? 1 : 0);
        node.disabled = node.permissions.disableable && (!!mapping?.disabled || !!namespace?.disabled || (configuration.builtinDisabled ?? []).includes(path));
        for (const child of node.children ?? []) apply(child, path);
    };
    apply(snapshot, '');
    return { name, root: snapshot };
}

/** @brief Apply Profile edits while the parent enforces server-owned child removal and insertion permissions. */
export function profileConfiguration(profile: Profile, current: RegistryConfiguration, commands: readonly CommandBrief[]): RegistryConfiguration {
    const protectedRoot = createNamespace({ tools: [], includeUnavailable: true });
    const configuration: RegistryConfiguration = { ...current, mappings: [], namespaces: [], order: [], toolComments: {}, builtinVisible: {}, builtinDisabled: [], namespaceVisible: {} };
    const visit = (node: SerializedNode, path: string, expected?: NamespaceNode | CommandNode): void => {
        if (node.disabled && expected && !expected.permissions.disableable) throw new Error(`Node cannot be disabled: ${path}`);
        if (node.type === 'leaf') {
            if (!node.command || node.children?.length || expected instanceof NamespaceNode) throw new Error(`Invalid command node: ${path}`);
            if (expected instanceof CommandNode) {
                if (node.command.tool !== expected.tool) throw new Error(`Protected command cannot be replaced: ${path}`);
                configuration.builtinVisible![path] = expected.fixLevel(node.fixedLevel);
                if (node.disabled) configuration.builtinDisabled!.push(path);
                return;
            }
            if (!commands.some(item => item.name === node.command!.tool)) throw new Error(`Unknown command: ${node.command.tool}`);
            const mounted = configuration.mappings.find(item => item.id === node.command!.tool);
            if (mounted) mounted.aliases.push(path);
            else configuration.mappings.push({ id: node.command.tool, path, aliases: [], pinned: false, disabled: node.disabled, alwaysVisible: node.fixedLevel ?? 0 });
            configuration.toolComments![node.command.tool] = node.command.doc;
            return;
        }
        if (node.command || expected instanceof CommandNode) throw new Error(`Invalid namespace node: ${path}`);
        const children = node.children ?? [];
        if (new Set(children.map(child => child.name)).size !== children.length) throw new Error(`Duplicate namespace member: ${path}`);
        if (expected instanceof NamespaceNode) {
            for (const child of expected.children.values()) if (!children.some(item => item.name === child.name) && !child.permissions.removable) throw new Error(`Node cannot be removed: ${child.path}`);
            if (path) {
                configuration.namespaceVisible![path] = !!fixLevel(expected.permissions, node.fixedLevel);
                if (node.disabled) configuration.builtinDisabled!.push(path);
            }
        } else if (path) configuration.namespaces.push({ path, description: node.description ?? '', alwaysVisible: !!node.fixedLevel, disabled: node.disabled });
        for (const child of children) {
            const childPath = path ? `${path}.${child.name}` : child.name;
            const existing = expected instanceof NamespaceNode ? expected.children.get(child.name) : undefined;
            if (!existing && expected && !expected.permissions.acceptsChildren) throw new Error(`Namespace does not accept children: ${path}`);
            configuration.order.push(childPath);
            visit(child, childPath, existing);
        }
    };
    if (profile.root.name !== '' || profile.root.type !== 'tree') throw new Error('Expected an anonymous namespace root');
    visit(profile.root, '', protectedRoot);
    return configuration;
}

/** @brief Shared Profile transport definition preloaded for PTC programs. */
export const profileAnnotation = `/** @brief Original physical command identity and summary. */
interface CommandBrief { name: string; brief: string; }
/** @brief Server-owned edit and pin choices; clients must honor these permissions. */
interface Permission { renamable: boolean; movable: boolean; removable: boolean; disableable: boolean; acceptsChildren: boolean; availableFixLevels: (0 | 1 | 2)[]; }
/** @brief Shared namespace tree or command leaf; protected children must remain present. */
interface NamespaceNode {
    type: 'tree' | 'leaf'; name: string; permissions: Permission;
    children?: NamespaceNode[];
    command?: { tool: string; argMap?: Record<string, string>; schema: Record<string, unknown>; output?: unknown; doc: string };
    description?: string; signature?: string; deployment?: 'tool' | 'environment'; preload?: boolean;
    fixedLevel?: 0 | 1 | 2; disabled?: boolean;
}
/** @brief Named namespace configuration with an anonymous root. */
interface Profile { name: string; root: NamespaceNode; }`;
