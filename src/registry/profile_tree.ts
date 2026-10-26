import { z } from 'zod';
import type { RegistryConfiguration } from './registry.js';
import { CommandNode, NamespaceNode, createNamespace } from '../namespace/namespace.js';
import { fixLevel, type SerializedNode } from '../namespace/node.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Physical command summary, mounting paths (including disabled paths) in the current Profile and global usage. */
export interface CommandBrief { name: CommandName; brief: string; paths: string[]; totalCalls: number }

/** @brief Available catalog Profile names and the current conversation selection. */
export interface Profiles { profiles: string[]; selected: string }

/** @brief Profiles expose the same serialized tree/leaf node description as management clients. */
export interface Profile { name: string; root: ProfileNode }

/** @brief Editable transport permits omitting a command brief without weakening native contracts. */
export interface ProfileNode extends Omit<SerializedNode, 'children' | 'command'> {
    children?: ProfileNode[];
    command?: Omit<NonNullable<SerializedNode['command']>, 'doc'> & { doc?: string };
}

/** @brief Validate shared permissions without trusting them as the server's authority. */
const permissionSchema = z.strictObject({
    commentable: z.boolean().default(true).describe('Whether simplified descriptions may be edited; forbidden descriptions are ignored.'),
    renamable: z.boolean().describe('Whether this node may be renamed.'),
    movable: z.boolean().describe('Whether this node may be moved.'),
    removable: z.boolean().describe('Whether this node may be removed.'),
    disableable: z.boolean().describe('Whether disabled may be set to true.'),
    acceptsChildren: z.boolean().describe('Whether new children may be inserted.'),
    availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).describe('Supported pin levels; an empty list means preserve the existing level.'),
});

/** @brief Recursive transport schema for both editable and protected Profile nodes. */
const nodeSchema: z.ZodType<ProfileNode> = z.lazy(() => z.strictObject({
    type: z.enum(['tree', 'leaf']), name: z.string(), permissions: permissionSchema,
    children: z.array(nodeSchema).optional(),
    command: z.strictObject({ tool: z.string().describe('Exact physical name from tools.profile.commands, including unmounted commands; do not use a namespace path.'), argMap: z.record(z.string(), z.string()).optional(), schema: z.record(z.string(), z.unknown()), output: z.unknown().optional(), doc: z.string().optional() }).optional(),
    description: z.string().optional().describe('Editable namespace description. For command descriptions, edit command.doc.'), deployment: z.enum(['tool', 'environment']).optional(), preload: z.boolean().optional(),
    fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe('Pin level: 0 none, 1 brief, 2 detailed; allowed values come from permissions.availableFixLevels.'),
    disabled: z.boolean().optional().describe('Disable this node and its subtree when permissions.disableable is true.'),
}));

/** @brief Validate editable Profile input; server-owned permissions remain authoritative. */
export const ProfileSchema: z.ZodType<Profile> = z.strictObject({ name: z.string(), root: nodeSchema.describe("Anonymous root. Missing protected descendants are restored recursively from the original Profile; submitted node settings are preserved. Server permissions govern edits, and forbidden descriptions are ignored.") });

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
    for (const mapping of configuration.mappings) {
        const path = mapping.path;
        const parts = path.split('.');
        nodeFor(parts.slice(0, -1).join('.')).add(new CommandNode(parts.at(-1)!, nodeFor(parts.slice(0, -1).join('.')), { tool: mapping.id, schema: {}, output: {}, doc: mapping.description ?? configuration.toolComments?.[mapping.id] ?? '' }));
    }
    const snapshot = root.serialize();
    const apply = (node: SerializedNode, prefix: string): void => {
        const path = prefix ? `${prefix}.${node.name}` : node.name;
        const mapping = configuration.mappings.find(item => item.path === path);
        const namespace = configuration.namespaces.find(item => item.path === path);
        node.fixedLevel = fixLevel(node.permissions, node.type === 'leaf' ? configuration.builtinVisible?.[path] ?? mapping?.alwaysVisible ?? 0
            : namespace?.alwaysVisible || configuration.namespaceVisible?.[path] ? 1 : 0);
        node.disabled = node.permissions.disableable && (!!mapping?.disabled || !!namespace?.disabled || (configuration.builtinDisabled ?? []).includes(path));
        for (const child of node.children ?? []) apply(child, path);
    };
    apply(snapshot, '');
    return { name, root: snapshot };
}

/** @brief Restore missing protected descendants, then apply edits under server-owned permissions without mutating input. */
export function profileConfiguration(profile: Profile, current: RegistryConfiguration, commands: readonly CommandBrief[]): RegistryConfiguration {
    const protectedRoot = createNamespace({ tools: [], includeUnavailable: true });
    const configuration: RegistryConfiguration = { ...current, mappings: [], namespaces: [], order: [], toolComments: {}, builtinVisible: {}, builtinDisabled: [], namespaceVisible: {} };
    const submitted: { node: ProfileNode; path: string }[] = [];
    const root = structuredClone(profile.root);
    const baseline = profileTree(profile.name, current).root;
    /** @brief Index submitted nodes and report both locations for repeated direct member names. */
    const collect = (node: ProfileNode, path: string): void => {
        submitted.push({ node, path });
        const names = new Map<string, number>();
        for (const [index, child] of (node.children ?? []).entries()) {
            const prior = names.get(child.name);
            const parent = path ? `root.${path}` : 'root';
            if (prior !== undefined) {
                const first = node.children![prior]!;
                throw new Error(`Duplicate namespace member: ${parent}.${child.name}; ${parent}.children[${prior}] (${first.command?.tool ?? first.type}) conflicts with ${parent}.children[${index}] (${child.command?.tool ?? child.type})`);
            }
            names.set(child.name, index);
            collect(child, path ? `${path}.${child.name}` : child.name);
        }
    };
    /** @brief Identify a protected node by physical commands retained at relative child paths, ignoring editable metadata. */
    const sameIdentity = (node: ProfileNode, expected: NamespaceNode | CommandNode): boolean => {
        if (expected instanceof CommandNode) return node.type === 'leaf' && node.command?.tool === expected.tool;
        return node.type === 'tree' && [...expected.children.values()].some(child =>
            (node.children ?? []).some(candidate => candidate.name === child.name && sameIdentity(candidate, child)));
    };
    collect(root, '');
    const visit = (node: ProfileNode, path: string, expected?: NamespaceNode | CommandNode, original?: ProfileNode): void => {
        if (node.disabled && expected && !expected.permissions.disableable) throw new Error(`Node cannot be disabled: ${path}`);
        if (node.type === 'leaf') {
            if (!node.command || node.children?.length || expected instanceof NamespaceNode) throw new Error(`Invalid command node: ${path}`);
            if (expected instanceof CommandNode) {
                if (node.command.tool !== expected.tool) throw new Error(`Protected command cannot be replaced: ${path}`);
                configuration.builtinVisible![path] = expected.fixLevel(node.fixedLevel ?? original?.fixedLevel);
                if (node.disabled ?? original?.disabled) configuration.builtinDisabled!.push(path);
                return;
            }
            if (!commands.some(item => item.name === node.command!.tool)) throw new Error(`Unknown command: ${node.command.tool}`);
            configuration.mappings.push({ id: node.command.tool, path, pinned: false, disabled: node.disabled,
                alwaysVisible: node.fixedLevel ?? 0, description: node.command.doc });
            return;
        }
        if (node.command || expected instanceof CommandNode) throw new Error(`Invalid namespace node: ${path}`);
        const children = node.children ??= [];
        if (expected instanceof NamespaceNode) {
            for (const child of expected.children.values()) {
                if (children.some(item => item.name === child.name) || child.permissions.removable) continue;
                const relocated = submitted.find(item => item.path && sameIdentity(item.node, child));
                if (relocated) {
                    if (relocated.node.name !== child.name && !child.permissions.renamable) throw new Error(`Node cannot be renamed: ${child.path} -> ${relocated.path} (root.${child.path} -> root.${relocated.path}; permissions.renamable=false; protected builtin node)`);
                    if (!child.permissions.movable) throw new Error(`Node cannot be moved: ${child.path} -> ${relocated.path} (root.${child.path} -> root.${relocated.path}; permissions.movable=false; preserve the protected builtin path)`);
                }
                children.push(structuredClone(original?.children?.find(item => item.name === child.name) ?? child.serialize()));
            }
            if (path) {
                configuration.namespaceVisible![path] = !!fixLevel(expected.permissions, node.fixedLevel ?? original?.fixedLevel);
                if (node.disabled ?? original?.disabled) configuration.builtinDisabled!.push(path);
            }
        } else if (path) configuration.namespaces.push({ path, description: node.description ?? '', alwaysVisible: !!node.fixedLevel, disabled: node.disabled });
        for (const child of children) {
            const childPath = path ? `${path}.${child.name}` : child.name;
            const existing = expected instanceof NamespaceNode ? expected.children.get(child.name) : undefined;
            if (!existing && expected && !expected.permissions.acceptsChildren) throw new Error(`Namespace does not accept children: ${path}`);
            configuration.order.push(childPath);
            visit(child, childPath, existing, original?.children?.find(item => item.name === child.name));
        }
    };
    if (profile.root.name !== '' || profile.root.type !== 'tree') throw new Error('Expected an anonymous namespace root');
    visit(root, '', protectedRoot, baseline);
    return configuration;
}

/** @brief Shared Profile transport definition preloaded for PTC programs. */
export const profileAnnotation = `/** @brief Physical command identity, summary, mounting paths (including disabled paths) in the current conversation Profile (empty when unmounted), and total calls across all sessions. Plugin builtins are excluded. */
interface CommandBrief { name: string; brief: string; paths: string[]; totalCalls: number; }
/** @brief Available catalog Profile names and the current conversation selection. */
interface Profiles { profiles: string[]; selected: string; }
/** @brief Server-owned permissions. Each field governs its own operation: commentable controls simplified descriptions, removable controls removal, disableable controls disabled, and availableFixLevels controls fixedLevel. Submitted permissions cannot override them. */
interface Permission { commentable: boolean; renamable: boolean; movable: boolean; removable: boolean; disableable: boolean; acceptsChildren: boolean; availableFixLevels: (0 | 1 | 2)[]; }
/** @brief Start from tools.profile.load(). Save recursively restores missing protected nodes from the existing Profile; submitted nodes retain their fixedLevel and other settings. Protected nodes still cannot be moved, renamed, replaced or extended. New commands may use any exact physical name from tools.profile.commands, even when absent from the loaded tree. A missing tree member is not a command template.
 * To mount a new command, append { type: 'leaf', name: 'cwd', permissions: { commentable: true, renamable: true, movable: true, removable: true, disableable: true, acceptsChildren: false, availableFixLevels: [0, 1, 2] }, command: { tool: '<exact physical name>', schema: {}, doc: '<one sentence>' } } to an ordinary namespace's children.
 * schema, output, deployment and preload describe native contracts; they cannot override execution. Edit optional command.doc for command descriptions and optional description for namespace descriptions. Server permissions.commentable governs edits; forbidden descriptions are ignored. Omitted command.doc uses the original command brief. Saving replaces the named catalog tree without switching the conversation. A rejected save or delete preserves saved Profiles.
 */
/** @brief Namespace tree or command leaf. disabled applies to the node and its subtree; fixedLevel controls pinning (0: none, 1: brief, 2: detailed). */
interface NamespaceNode {
    type: 'tree' | 'leaf'; name: string; permissions: Permission;
    children?: NamespaceNode[];
    command?: { tool: string; argMap?: Record<string, string>; schema: Record<string, unknown>; output?: unknown; doc?: string };
    description?: string; deployment?: 'tool' | 'environment'; preload?: boolean;
    fixedLevel?: 0 | 1 | 2; disabled?: boolean;
}
/** @brief Named namespace configuration with an anonymous root. */
interface Profile { name: string; root: NamespaceNode; }
`;
