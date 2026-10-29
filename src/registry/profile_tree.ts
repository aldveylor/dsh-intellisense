import { EditableNamespace } from './profile/namespace.js';
import type { ProfileNamespace } from './profile/namespace.js';
import { validateProfileEdit } from './profile/validate_edit.js';
import { defaultNamespaceDefinitions, type NamespaceDefinitions } from '../namespace/definitions.js';
import { settingsAt } from './profile/node_settings.js';
import { ProfilePermissionError, UnknownCommandError } from '../error.js';
import { z } from 'zod';
import { RegistryConfiguration, type RegistryConfigurationData } from './configuration.js';
import type { Saveable } from '../storage/saveable.js';
import { CommandNode, NamespaceNode, createNamespace } from '../namespace/namespace.js';
import { fixLevel, nodePermissions, type SerializedNode } from '../namespace/node.js';
import type { ProfileTreeNode, NamespaceTreeNode } from './profile_node.js';
import { validatePath } from './path.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Physical command summary, mount paths (including disabled paths) in the current Profile and global usage. */
export interface CommandBrief { name: CommandName; brief: string; paths: string[]; totalCalls: number }

/** @brief Available catalog Profile names and the current conversation selection. */
export interface Profiles { profiles: string[]; selected: string }

/** @brief Named editable namespace tree. */
export interface ProfileData { name: string; brief?: string; root: NamespaceTreeNode }

/** @brief Editable Profile tree retaining its transport shape and independent nested data. */
export class ProfileDocument implements Saveable<ProfileData> {
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
    if (children && result.type === 'namespace') result.children = Object.fromEntries(Object.entries(children).map(([name, child]) => [name, compactProfileNode(child)]));
    return result;
}

/** @brief Project executable nodes into editable Profile data. */
function profileNode(node: SerializedNode): ProfileTreeNode {
    const common = { permissions: node.permissions, fixedLevel: node.fixedLevel, disabled: node.disabled };
    if (node.type === 'leaf') {
        const { tool, doc } = node.command!;
        return { ...common, type: 'command', command: { tool, doc } };
    }
    return { ...common, type: 'namespace', fixedLevel: node.fixedLevel === 2 ? 1 : node.fixedLevel, description: node.description, children: Object.fromEntries((node.children ?? []).map(child => [child.name, profileNode(child)])) };
}

/** @brief Validate shared permissions without trusting them as the server's authority. */
const permissionSchema = z.strictObject({
    commentable: z.boolean().optional().describe('Whether description/command.doc may be edited in the saved Profile; when false, preserve the original description; forbidden changes throw.'),
    renamable: z.boolean().optional().describe('Whether this member may be renamed in the saved Profile; when false, preserve its original name.'),
    movable: z.boolean().optional().describe('Whether this member may be moved in the saved Profile; when false, preserve its original parent and path.'),
    removable: z.boolean().optional().describe('Whether this member may be omitted from the saved Profile; when false, retain it in the Profile tree even if unused (omitting protected members throws).'),
    disableable: z.boolean().optional().describe('Whether this member may have disabled: true in the saved Profile; when false, keep it enabled.'),
    acceptsChildren: z.boolean().optional().describe('Whether new members may be added to this namespace in the saved Profile; when false, preserve its existing membership.'),
    availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional().describe('Allowed fixedLevel values in the saved Profile; an empty list means preserve the existing level.'),
});

/** @brief Shared editable node properties. */
const nodeProperties = {
    permissions: permissionSchema.optional().describe('Constraints on the saved Profile tree: retain protected members with their required names, paths and command identities. Protection belongs only to the plugin-owned tools subtree; ordinary mounted commands such as fs.* and bash are removable and are not restored when omitted. Read-only server rules returned by load; save/apply reject permissions. Defaults: commentable, renamable, movable, removable and disableable true; acceptsChildren false for commands, true for namespaces; availableFixLevels [0,1,2] for commands, [0,1] for namespaces. Omitted permissions or fields use ordinary defaults and do not imply protection; server restrictions remain authoritative.'),
    fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe('Pin level (default 0, omitted): 0 none, 1 brief, 2 detailed; allowed values come from permissions.availableFixLevels.'),
    disabled: z.boolean().optional().describe('Default false (omitted). Disabled nodes and descendants are excluded from discovery, runtime bindings, native tools, preloaded values and pinned prompts; configuration is retained for re-enabling. Disabling tools also removes tools.inspect guidance.'),
};

/** @brief Reject empty, invalid and JavaScript convention member keys before record parsing. */
const memberNameSchema = z.string().regex(/^[A-Za-z_][\w$]*$/, 'Invalid namespace member name').refine(
    name => !Object.hasOwn(Object.prototype, name) && !['prototype', 'then'].includes(name) && !name.startsWith('__'),
    'Reserved JavaScript member name');

/** @brief Recursive namespace transport with directly nested command or namespace members. */
const namespaceSchema: z.ZodType<NamespaceTreeNode> = z.lazy(() => z.strictObject({
    ...nodeProperties, type: z.literal('namespace'), fixedLevel: z.union([z.literal(0), z.literal(1)]).optional().describe('Namespace pin level (default 0, omitted): 0 none, 1 visible; allowed values come from permissions.availableFixLevels.'), children: z.preprocess((value, context) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const name of Object.keys(value)) {
                if (!memberNameSchema.safeParse(name).success) context.addIssue({ code: 'custom', path: [name], message: `Invalid or reserved namespace member name: ${name}` });
            }
        }
        return value;
    }, z.record(memberNameSchema, nodeSchema)).optional(),
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
export const ProfileSchema: z.ZodType<ProfileData> = z.strictObject({ name: z.string(), brief: z.string().optional().describe('Short description of the Profile purpose.'), root: namespaceSchema.describe("Anonymous namespace root of editable Profile data. Member names are children record keys. Server-owned node permissions govern edits.") });

/** @brief Create protected children first, then add configured mappings without replacing existing nodes. */
export function profileTree(name: string, configuration: RegistryConfigurationData, definitions: NamespaceDefinitions = defaultNamespaceDefinitions): ProfileDocument {
    const definition = new EditableNamespace('', configuration.providedRoot ?? definitions.tree(name));
    const nodeFor = (parts: string[]): ProfileNamespace => parts.reduce((parent, name) => parent.getOrCreate(name), definition as ProfileNamespace);
    for (const item of configuration.namespaces) nodeFor(item.path.split('.')).setDescription(item.description);
    for (const mapping of configuration.mappings) {
        const parts = mapping.path.split('.');
        const parent = nodeFor(parts.slice(0, -1));
        if (parent.get(parts.at(-1)!)) continue;
        const command = parent.create(parts.at(-1)!, 'command').setTool(mapping.id);
        const description = mapping.description ?? configuration.toolComments?.[mapping.id];
        if (description !== undefined) command.setDescription(description);
    }
    const root = createNamespace({ tools: [], includeUnavailable: true, definitions: definition.serialize(), addition: tool => definitions.addition(tool), nodeSettings: configuration.nodeSettings });
    const snapshot = profileNode(root.serialize()) as NamespaceTreeNode;
    const apply = (node: ProfileTreeNode, path: string): void => {
        const setting = settingsAt(configuration.nodeSettings, path ? path.split('.') : []);
        if (setting?.description !== undefined) {
            if (node.type === 'namespace') node.description = setting.description;
            else node.command.doc = setting.description;
        }
        const mapping = configuration.mappings.find(item => item.path === path);
        const namespace = configuration.namespaces.find(item => item.path === path);
        const permissions = nodePermissions(node.type === 'command' ? 'leaf' : 'tree', node.permissions);
        const level = fixLevel(permissions, node.type === 'command' ? configuration.builtinVisible?.[path] ?? mapping?.alwaysVisible ?? node.fixedLevel ?? 0
            : namespace?.alwaysVisible || configuration.namespaceVisible?.[path] ? 1 : 0);
        if (node.type === 'command') node.fixedLevel = level;
        else node.fixedLevel = level === 2 ? 1 : level;
        node.disabled = permissions.disableable && (!!mapping?.disabled || !!namespace?.disabled || (configuration.builtinDisabled ?? []).includes(path));
        for (const [name, child] of Object.entries(node.children ?? {})) apply(child, path ? `${path}.${name}` : name);
    };
    apply(snapshot, '');
    return new ProfileDocument({ name, brief: configuration.brief, root: snapshot });
}

/** @brief Validate all writes under server-owned permissions, then build independent configuration data. */
export function profileConfiguration(profile: ProfileData, current: RegistryConfigurationData, commands: readonly CommandBrief[], definitions: NamespaceDefinitions = defaultNamespaceDefinitions): RegistryConfiguration {
    profile = ProfileSchema.parse(profile);
    const protectedRoot = createNamespace({ tools: [], includeUnavailable: true, definitions: current.providedRoot ?? definitions.tree(profile.name), nodeSettings: current.nodeSettings });
    const configuration = new RegistryConfiguration({ ...current, brief: profile.brief, mappings: [], namespaces: [], order: [], toolComments: {}, builtinVisible: {}, builtinDisabled: [], namespaceVisible: {} });
    const submitted: { node: ProfileTreeNode; path: string }[] = [];
    const root = structuredClone(profile.root);
    const baseline = profileTree(profile.name, current, definitions).root;
    /** @brief Index submitted nodes by paths derived from member keys. */
    const collect = (node: ProfileTreeNode, path: string): void => {
        submitted.push({ node, path });
        for (const [name, child] of Object.entries(node.children ?? {})) collect(child, path ? `${path}.${name}` : name);
    };
    /** @brief Identify a protected node by physical commands retained at relative child paths, ignoring editable metadata. */
    const sameIdentity = (node: ProfileTreeNode, expected: NamespaceNode | CommandNode): boolean => {
        if (expected instanceof CommandNode) return node.type === 'command' && node.command?.tool === expected.tool;
        return node.type === 'namespace' && [...expected.children.values()].some(child =>
            Object.hasOwn(node.children ?? {}, child.name) && sameIdentity(node.children![child.name]!, child));
    };
    validateProfileEdit(baseline, root);
    collect(root, '');
    const visit = (node: ProfileTreeNode, path: string, expected?: NamespaceNode | CommandNode, original?: ProfileTreeNode): void => {
        if (path && !expected) validatePath(path);
        if (expected && (node.type === 'command') !== (expected instanceof CommandNode)) throw new ProfilePermissionError(`Protected node cannot be replaced: ${path}`);
        if (expected) {
            const level = node.fixedLevel ?? 0;
            const levels = expected.permissions.availableFixLevels;
            if (levels.length ? !levels.includes(level) : level !== (original?.fixedLevel ?? 0)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${path} (permissions.availableFixLevels)`);
            if (!expected.permissions.commentable && (node.type === 'command' ? node.command?.doc !== original?.command?.doc : node.description !== original?.description)) throw new ProfilePermissionError(`Node documentation cannot be changed: ${path} (permissions.commentable=false)`);
        }
        if (node.disabled && expected && !expected.permissions.disableable) throw new ProfilePermissionError(`Node cannot be disabled: ${path}`);
        if (node.type === 'command') {
            if (!node.command || expected instanceof NamespaceNode) throw new ProfilePermissionError(`Invalid command node: ${path}`);
            if (expected instanceof CommandNode) {
                if (node.command.tool !== expected.tool) throw new ProfilePermissionError(`Protected command cannot be replaced: ${path}`);
                configuration.builtinVisible![path] = expected.fixLevel(node.fixedLevel);
                if (node.disabled) configuration.builtinDisabled!.push(path);
                return;
            }
            if (!commands.some(item => item.name === node.command!.tool) && !(definitions.addition(node.command.tool).fixed && current.mappings.some(mapping => mapping.id === node.command!.tool && mapping.path === path))) throw new UnknownCommandError(node.command.tool);
            configuration.mappings.push({ id: node.command.tool, path, pinned: false, disabled: node.disabled,
                alwaysVisible: node.fixedLevel ?? 0, description: node.command.doc });
            return;
        }
        if (node.command || expected instanceof CommandNode) throw new ProfilePermissionError(`Invalid namespace node: ${path}`);
        const children = node.children ??= {};
        if (expected instanceof NamespaceNode) {
            for (const child of expected.children.values()) {
                if (Object.hasOwn(children, child.name) || child.permissions.removable) continue;
                const relocated = submitted.find(item => item.path && sameIdentity(item.node, child));
                if (relocated) {
                    if (relocated.path.split('.').at(-1) !== child.name && !child.permissions.renamable) throw new ProfilePermissionError(`Node cannot be renamed: ${child.path} -> ${relocated.path} (root.${child.path} -> root.${relocated.path}; permissions.renamable=false; protected builtin node)`);
                    if (!child.permissions.movable) throw new ProfilePermissionError(`Node cannot be moved: ${child.path} -> ${relocated.path} (root.${child.path} -> root.${relocated.path}; permissions.movable=false; preserve the protected builtin path)`);
                }
                throw new ProfilePermissionError(`Node cannot be removed: ${child.path} (permissions.removable=false)`);
            }
            if (path) {
                configuration.namespaceVisible![path] = !!fixLevel(expected.permissions, node.fixedLevel);
                if (node.disabled) configuration.builtinDisabled!.push(path);
            }
        } else if (path) configuration.namespaces.push({ path, description: node.description ?? '', alwaysVisible: !!node.fixedLevel, disabled: node.disabled });
        for (const [name, child] of Object.entries(children)) {
            const childPath = path ? `${path}.${name}` : name;
            const existing = expected instanceof NamespaceNode ? expected.children.get(name) : undefined;
            if (!existing && expected && !expected.permissions.acceptsChildren) throw new ProfilePermissionError(`Namespace does not accept children: ${path}`);
            configuration.order.push(childPath);
            visit(child, childPath, existing, original?.children && Object.hasOwn(original.children, name) ? original.children[name] : undefined);
        }
    };
    if (profile.root.type !== 'namespace') throw new ProfilePermissionError('Expected an anonymous namespace root');
    visit(root, '', protectedRoot, baseline);
    if (current.providedRoot) {
        const retain = (source: ProfileTreeNode, submitted: ProfileTreeNode): ProfileTreeNode => source.type === 'command' ? structuredClone(source)
            : { ...structuredClone(source), children: Object.fromEntries(Object.entries(source.children ?? {}).filter(([name]) => Object.hasOwn(submitted.children ?? {}, name))
                .map(([name, child]) => [name, retain(child, submitted.children![name]!)])) };
        configuration.providedRoot = retain(current.providedRoot, profile.root) as NamespaceTreeNode;
    }
    return configuration;
}

/** @brief Shared Profile transport definition preloaded for PTC programs. */
export const profileAnnotation = `/** @brief Physical command identity, summary, mount paths (including disabled paths) in the current conversation Profile (empty when unmounted), and total calls across all sessions. Plugin builtins are excluded. */
interface CommandBrief { name: string; brief: string; paths: string[]; totalCalls: number; }
/** @brief Available catalog Profile names and the current conversation selection. */
interface Profiles { profiles: string[]; selected: string; }
/** @brief Server-owned constraints on edits to the saved Profile tree. Read-only metadata returned by load; save/apply reject permissions at every depth. */
interface Permission {
    /** @brief When false, preserve the original Profile description/command.doc; forbidden changes throw. */
    /** @default true */
    commentable?: boolean;
    /** @brief When false, retain this member under its original name in the saved Profile. */
    /** @default true */
    renamable?: boolean;
    /** @brief When false, retain this member under its original parent and path in the saved Profile. */
    /** @default true */
    movable?: boolean;
    /** @brief When false, retain this member in the saved Profile even if unused; omitting protected members throws. */
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
/** @brief The live runtime namespace tree must not be mutated: do not assign, delete, rename, move or add runtime namespace members, regardless of Profile permissions. Profile permissions govern the saved configuration tree.
 * To mount a new command, assign children.cwd = { type: 'command', command: { tool: '<exact physical name>', doc: '<one sentence>' } } on an ordinary namespace. Use an exact physical name from tools.profile.commands, including unmounted commands. Member names are children record keys; rename or move members by changing their keys or parent records.
 */
/** @brief Shared editable type and visibility. Default values are omitted from serialization. disabled applies to the node and its subtree: they disappear from discovery, runtime bindings, native tools, preloaded values and pinned prompts, while their configuration is retained for re-enabling. Disabling tools also removes tools.inspect guidance. fixedLevel controls pinning (0: none, 1: brief, 2: detailed). */
interface ProfileNode {
    type: string;
    /** @brief Constraints for retaining and editing members in the saved Profile; they do not permit mutation of the live runtime namespace tree. */
    /** @default {} (ordinary node permissions) */
    permissions?: Permission;
    /** @default 0 */
    fixedLevel?: number;
    /** @default false */
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
/** @brief Namespace containing directly nested Profile members keyed by name. */
interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    /** @default 0 */
    fixedLevel?: 0 | 1;
    children?: Record<string, CommandNode | NamespaceTreeNode>;
    description?: string;
}
/** @brief Named namespace configuration with an anonymous root. */
interface Profile { name: string; brief?: string; root: NamespaceTreeNode; }
/** @brief Writable command; never submit permissions. */
interface CommandWrite extends Omit<CommandNode, 'permissions'> {}
/** @brief Writable namespace; recursively omit permissions. */
interface NamespaceWrite extends Omit<NamespaceTreeNode, 'permissions' | 'children'> {
    children?: Record<string, CommandWrite | NamespaceWrite>;
}
/** @brief save input. Target name is a separate argument; omit name and all permissions from load data. */
/** @brief Anonymous root has no persisted visibility, pin or description settings. */
interface ProfileRootWrite extends Omit<NamespaceWrite, 'fixedLevel' | 'disabled' | 'description'> {}
interface ProfileWrite extends Omit<Profile, 'name' | 'root'> { root: ProfileRootWrite; }
/** @brief apply input: recursively partial writable fields; null deletes optional fields or named children. Required fields cannot be deleted. */
type ProfilePatch<T = ProfileWrite> = { [K in keyof T]?: T[K] extends object | undefined ? ProfilePatch<NonNullable<T[K]>> | null : T[K] | null };

`;
