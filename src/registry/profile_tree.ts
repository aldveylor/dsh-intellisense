import { z } from 'zod';
import { RegistryConfiguration, type RegistryConfigurationData } from './configuration.js';
import type { Saveable } from '../storage/saveable.js';
import { CommandNode, NamespaceNode, createNamespace } from '../namespace/namespace.js';
import { fixLevel, nodePermissions, type SerializedNode } from '../namespace/node.js';
import type { ProfileTreeNode, NamespaceTreeNode } from './profile_node.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Physical command summary, mount paths (including disabled paths) in the current Profile and global usage. */
export interface CommandBrief { name: CommandName; brief: string; paths: string[]; totalCalls: number }

/** @brief Available catalog Profile names and the current conversation selection. */
export interface Profiles { profiles: string[]; selected: string }

/** @brief Named editable namespace tree. */
export interface ProfileData { name: string; brief?: string; root: NamespaceTreeNode }

/** @brief Editable Profile tree retaining its transport shape and independent nested data. */
export class Profile implements Saveable<ProfileData> {
    name: string;
    brief?: string;
    root: NamespaceTreeNode;

    constructor(data?: ProfileData) {
        this.name = data?.name ?? 'Default';
        this.brief = data?.brief;
        this.root = compactProfileNode(data?.root ?? profileNode(createNamespace({ tools: [], includeUnavailable: true }).serialize())) as NamespaceTreeNode;
    }

    save(): ProfileData { return { name: this.name, ...(this.brief === undefined ? {} : { brief: this.brief }), root: compactProfileNode(this.root) as NamespaceTreeNode }; }
}

/** @brief Copy Profile data while omitting default permissions, pin levels and enabled state. */
function compactProfileNode(node: ProfileTreeNode): ProfileTreeNode {
    const { children, ...data } = node;
    const result = structuredClone(data) as ProfileTreeNode;
    const defaults = nodePermissions(node.type === 'command' ? 'leaf' : 'tree');
    const permissions = Object.fromEntries(Object.entries(result.permissions ?? {}).filter(([key, value]) =>
        value !== undefined && JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
    if (Object.keys(permissions).length) result.permissions = permissions;
    else delete result.permissions;
    if (!result.fixedLevel) delete result.fixedLevel;
    if (!result.disabled) delete result.disabled;
    if (children && result.type === 'namespace') result.children = children.map(compactProfileNode);
    return result;
}

/** @brief Project executable nodes into editable Profile data. */
function profileNode(node: SerializedNode): ProfileTreeNode {
    const common = { name: node.name, permissions: node.permissions, fixedLevel: node.fixedLevel, disabled: node.disabled };
    if (node.type === 'leaf') {
        const { tool, doc } = node.command!;
        return { ...common, type: 'command', command: { tool, doc } };
    }
    return { ...common, type: 'namespace', fixedLevel: node.fixedLevel === 2 ? 1 : node.fixedLevel, description: node.description, children: (node.children ?? []).map(profileNode) };
}

/** @brief Validate shared permissions without trusting them as the server's authority. */
const permissionSchema = z.strictObject({
    commentable: z.boolean().optional().describe('Whether description/command.doc may be edited in the saved Profile; when false, preserve the original description (submitted changes are ignored).'),
    renamable: z.boolean().optional().describe('Whether this member may be renamed in the saved Profile; when false, preserve its original name.'),
    movable: z.boolean().optional().describe('Whether this member may be moved in the saved Profile; when false, preserve its original parent and path.'),
    removable: z.boolean().optional().describe('Whether this member may be omitted from the saved Profile; when false, retain it in the Profile tree even if unused (missing protected members are restored on save).'),
    disableable: z.boolean().optional().describe('Whether this member may have disabled: true in the saved Profile; when false, keep it enabled.'),
    acceptsChildren: z.boolean().optional().describe('Whether new members may be added to this namespace in the saved Profile; when false, preserve its existing membership.'),
    availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional().describe('Allowed fixedLevel values in the saved Profile; an empty list means preserve the existing level.'),
});

/** @brief Shared editable node properties. */
const nodeProperties = {
    name: z.string(), permissions: permissionSchema.optional().describe('Constraints on the saved Profile tree: retain protected members with their required names, paths and command identities. These constraints apply when editing Profile data for save, not only during tool execution. Optional permission overrides. Defaults: commentable, renamable, movable, removable and disableable true; acceptsChildren false for commands, true for namespaces; availableFixLevels [0,1,2] for commands, [0,1] for namespaces. Omitted fields use defaults; server restrictions remain authoritative.'),
    fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe('Pin level (default 0, omitted): 0 none, 1 brief, 2 detailed; allowed values come from permissions.availableFixLevels.'),
    disabled: z.boolean().optional().describe('Default false (omitted), except tools.profile.save defaults the protected tools namespace to disabled unless explicitly set to false. Disabled nodes and descendants are excluded from discovery, runtime bindings, native tools, preloaded values and pinned prompts; configuration is retained for re-enabling. Disabling tools also removes tools.inspect guidance.'),
};

/** @brief Recursive namespace transport with directly nested command or namespace members. */
const namespaceSchema: z.ZodType<NamespaceTreeNode> = z.lazy(() => z.strictObject({
    ...nodeProperties, type: z.literal('namespace'), fixedLevel: z.union([z.literal(0), z.literal(1)]).optional().describe('Namespace pin level (default 0, omitted): 0 none, 1 visible; allowed values come from permissions.availableFixLevels.'), children: z.array(nodeSchema).optional(),
    description: z.string().optional().describe('Editable namespace description.'),
}));

/** @brief Validate command and namespace members by their discriminator. */
const nodeSchema: z.ZodType<ProfileTreeNode> = z.lazy(() => z.union([
    namespaceSchema,
    z.strictObject({
        ...nodeProperties, type: z.literal('command'),
        command: z.strictObject({ tool: z.string().describe('Exact physical name from tools.profile.commands, including unmounted commands; do not use a namespace path.'), doc: z.string().optional().describe('One-sentence summary of the command functionality; cannot modify the original command documentation or schema.') }),
    }),
]));

/** @brief Validate editable Profile input; server-owned permissions remain authoritative. */
export const ProfileSchema: z.ZodType<ProfileData> = z.strictObject({ name: z.string(), brief: z.string().optional().describe('Short description of the Profile purpose.'), root: namespaceSchema.describe("Anonymous root of editable Profile data, separate from the live runtime namespace tree. Do not mutate the runtime namespace tree or assign, delete, rename or move its members; edit data returned by tools.profile.load(), save it, then switch to apply it. The saved Profile must retain protected members at their original names and paths with their original command identities. Missing protected descendants are restored recursively from the original Profile; submitted node settings are preserved. Server permissions govern edits, and forbidden descriptions are ignored.") });

/** @brief Create protected children first, then add configured mappings without replacing existing nodes. */
export function profileTree(name: string, configuration: RegistryConfigurationData): Profile {
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
    const snapshot = profileNode(root.serialize()) as NamespaceTreeNode;
    const apply = (node: ProfileTreeNode, prefix: string): void => {
        const path = prefix ? `${prefix}.${node.name}` : node.name;
        const mapping = configuration.mappings.find(item => item.path === path);
        const namespace = configuration.namespaces.find(item => item.path === path);
        const permissions = nodePermissions(node.type === 'command' ? 'leaf' : 'tree', node.permissions);
        const level = fixLevel(permissions, node.type === 'command' ? configuration.builtinVisible?.[path] ?? mapping?.alwaysVisible ?? 0
            : namespace?.alwaysVisible || configuration.namespaceVisible?.[path] ? 1 : 0);
        if (node.type === 'command') node.fixedLevel = level;
        else node.fixedLevel = level === 2 ? 1 : level;
        node.disabled = permissions.disableable && (!!mapping?.disabled || !!namespace?.disabled || (configuration.builtinDisabled ?? []).includes(path));
        for (const child of node.children ?? []) apply(child, path);
    };
    apply(snapshot, '');
    return new Profile({ name, brief: configuration.brief, root: snapshot });
}

/**
 * @brief Restore missing protected descendants, then apply edits under server-owned permissions without mutating input.
 * @param onComplete Optional observer called with each protected path restored into the input tree copy.
 */
export function profileConfiguration(profile: ProfileData, current: RegistryConfigurationData, commands: readonly CommandBrief[], onComplete?: (path: string) => void): RegistryConfiguration {
    const protectedRoot = createNamespace({ tools: [], includeUnavailable: true });
    const configuration = new RegistryConfiguration({ ...current, brief: profile.brief, mappings: [], namespaces: [], order: [], toolComments: {}, builtinVisible: {}, builtinDisabled: [], namespaceVisible: {} });
    const submitted: { node: ProfileTreeNode; path: string }[] = [];
    const root = structuredClone(profile.root);
    const baseline = profileTree(profile.name, current).root;
    /** @brief Index submitted nodes and report both locations for repeated direct member names. */
    const collect = (node: ProfileTreeNode, path: string): void => {
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
    const sameIdentity = (node: ProfileTreeNode, expected: NamespaceNode | CommandNode): boolean => {
        if (expected instanceof CommandNode) return node.type === 'command' && node.command?.tool === expected.tool;
        return node.type === 'namespace' && [...expected.children.values()].some(child =>
            (node.children ?? []).some(candidate => candidate.name === child.name && sameIdentity(candidate, child)));
    };
    collect(root, '');
    const visit = (node: ProfileTreeNode, path: string, expected?: NamespaceNode | CommandNode, original?: ProfileTreeNode): void => {
        if (node.disabled && expected && !expected.permissions.disableable) throw new Error(`Node cannot be disabled: ${path}`);
        if (node.type === 'command') {
            if (!node.command || expected instanceof NamespaceNode) throw new Error(`Invalid command node: ${path}`);
            if (expected instanceof CommandNode) {
                if (node.command.tool !== expected.tool) throw new Error(`Protected command cannot be replaced: ${path}`);
                configuration.builtinVisible![path] = expected.fixLevel(node.fixedLevel);
                if (node.disabled) configuration.builtinDisabled!.push(path);
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
                onComplete?.(child.path);
                children.push(structuredClone(original?.children?.find(item => item.name === child.name) ?? profileNode(child.serialize())));
            }
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
            visit(child, childPath, existing, original?.children?.find(item => item.name === child.name));
        }
    };
    if (profile.root.name !== '' || profile.root.type !== 'namespace') throw new Error('Expected an anonymous namespace root');
    visit(root, '', protectedRoot, baseline);
    return configuration;
}

/** @brief Shared Profile transport definition preloaded for PTC programs. */
export const profileAnnotation = `/** @brief Physical command identity, summary, mount paths (including disabled paths) in the current conversation Profile (empty when unmounted), and total calls across all sessions. Plugin builtins are excluded. */
interface CommandBrief { name: string; brief: string; paths: string[]; totalCalls: number; }
/** @brief Available catalog Profile names and the current conversation selection. */
interface Profiles { profiles: string[]; selected: string; }
/** @brief Server-owned constraints on the saved Profile tree, not merely restrictions during tool execution. The Profile must retain protected members at their original names and paths with their original command identities, even if unused. Each field governs its own Profile edit: commentable controls simplified descriptions, removable controls removal, disableable controls disabled, and availableFixLevels controls fixedLevel. Omitted permissions or fields use their documented defaults. Only nondefault overrides are serialized. Submitted permissions cannot override server restrictions. */
interface Permission {
    /** @brief When false, preserve the original Profile description/command.doc; submitted changes are ignored. */
    /** @default true */
    commentable?: boolean;
    /** @brief When false, retain this member under its original name in the saved Profile. */
    /** @default true */
    renamable?: boolean;
    /** @brief When false, retain this member under its original parent and path in the saved Profile. */
    /** @default true */
    movable?: boolean;
    /** @brief When false, retain this member in the saved Profile even if unused; missing protected members are restored on save. */
    /** @default true */
    removable?: boolean;
    /** @brief When false, keep this member enabled in the saved Profile. */
    /** @default true */
    disableable?: boolean;
    /** @brief When false, preserve existing namespace membership in the saved Profile; do not add members. */
    /** @default false for commands; true for namespaces */
    acceptsChildren?: boolean;
    /** @brief Allowed fixedLevel values in the saved Profile; an empty list means preserve the existing level. */
    /** @default [0, 1, 2] for commands; [0, 1] for namespaces */
    availableFixLevels?: (0 | 1 | 2)[];
}
/** @brief Edit the Profile data returned by tools.profile.load(), then save it and call tools.profile.switch(name) to apply it. The live runtime namespace tree must not be mutated: do not assign, delete, rename, move or add runtime namespace members, regardless of Profile permissions. Profile permissions govern the saved configuration tree. Save recursively restores missing protected nodes from the existing Profile; submitted nodes retain their fixedLevel and other settings. Protected nodes still cannot be moved, renamed, replaced or extended. New commands may use any exact physical name from tools.profile.commands, even when absent from the loaded tree. A missing tree member is not a command template.
 * The tools namespace is protected but defaults to disabled on save, including when omitted or when its disabled field is omitted. Set tools.disabled to false explicitly to enable it.
 * When inspect is unavailable, including when tools is disabled, fix all other commands at level 2 or disable them. This is advisory and does not block saving.
 * To mount a new command, append { type: 'command', name: 'cwd', command: { tool: '<exact physical name>', doc: '<one sentence>' } } to an ordinary namespace's children.
 * Edit optional command.doc for a one-sentence summary of the command functionality; it cannot modify the original command documentation or schema. Edit optional description for namespace descriptions. Server permissions.commentable governs edits; forbidden descriptions are ignored. Saving replaces the named catalog tree without switching the conversation. A rejected save or delete preserves saved Profiles.
 */
/** @brief Shared editable identity and visibility. Default values are omitted from serialization. disabled applies to the node and its subtree: they disappear from discovery, runtime bindings, native tools, preloaded values and pinned prompts, while their configuration is retained for re-enabling. Disabling tools also removes tools.inspect guidance. fixedLevel controls pinning (0: none, 1: brief, 2: detailed). */
interface ProfileNode {
    type: string; name: string;
    /** @brief Constraints for retaining and editing members in the saved Profile; they do not permit mutation of the live runtime namespace tree. */
    /** @default {} (ordinary node permissions) */
    permissions?: Permission;
    /** @default 0 */
    fixedLevel?: number;
    /** @default false; tools.profile.save defaults the protected tools namespace to true unless explicitly false */
    disabled?: boolean;
}
/** @brief Physical command mounted at a named Profile member. */
interface CommandNode extends ProfileNode {
    type: 'command';
    /** @default 0 */
    fixedLevel?: 0 | 1 | 2;
    command: {
        tool: string;
        /** @brief One-sentence summary of the command functionality; cannot modify the original tool's documentation or schema. */
        /** @default Original command brief */
        doc?: string;
    };
}
/** @brief Namespace containing directly nested Profile members. */
interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    /** @default 0 */
    fixedLevel?: 0 | 1;
    children?: (CommandNode | NamespaceTreeNode)[];
    description?: string;
}
/** @brief Named namespace configuration with an anonymous root. */
interface Profile { name: string; brief?: string; root: NamespaceTreeNode; }
`;
