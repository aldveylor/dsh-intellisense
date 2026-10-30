import { EditableNamespace } from '../namespace.js';
import { EditableFunction } from '../function.js';
import type { ProfileFunction } from '../function.js';
import type { ProfileNamespace } from '../namespace.js';
import { applyProfile } from '../edit.js';
import { compareProfile } from '../compare.js';
import { toPlaneProfile } from '../plane/to_plane_profile.js';
import { profileWrite } from './profile_write.js';
import { defaultNamespaceDefinitions, type NamespaceDefinitions } from '../namespace/definitions.js';
import { settingsAt } from '../node_settings.js';
import { z } from 'zod';
import { PlaneProfile, type PlaneProfileData } from '../plane/profile.js';
import type { Saveable } from '../../storage/saveable.js';
import { fixLevel, nodePermissions } from '../namespace/node.js';
import type { ProfileTreeNode, NamespaceTreeNode } from './profile_node.js';

/** @brief Physical command identity used by editable Profile trees. */
export type CommandName = string;

/** @brief Physical tool summary, mount paths (including disabled paths) in the current Profile and global usage. */
export interface ToolBrief { name: CommandName; brief: string; paths: string[]; totalCalls: number }

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
        this.root = compactProfileNode(data?.root ?? defaultNamespaceDefinitions.createInitialProfile().serialize()) as NamespaceTreeNode;
    }

    save(): ProfileData { return { name: this.name, ...(this.brief === undefined ? {} : { brief: this.brief }), root: compactProfileNode(this.root) as NamespaceTreeNode }; }
}

/** @brief Copy Profile data while omitting default permissions, pin levels and enabled state. */
function compactProfileNode(node: ProfileTreeNode): ProfileTreeNode {
    const { children, ...data } = node;
    const result = structuredClone(data) as ProfileTreeNode;
    const defaults = nodePermissions(node.type === 'function' ? 'leaf' : 'tree');
    const permissions = Object.fromEntries(Object.entries(result.permissions ?? {}).filter(([key, value]) =>
        value !== undefined && JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
    if (Object.keys(permissions).length) result.permissions = permissions;
    else delete result.permissions;
    if (!result.fixedLevel) delete result.fixedLevel;
    if (!result.disabled) delete result.disabled;
    if (children && result.type === 'namespace') result.children = Object.fromEntries(Object.entries(children).map(([name, child]) => [name, compactProfileNode(child)]));
    return result;
}

/** @brief Validate shared permissions without trusting them as the server's authority. */
const permissionSchema = z.strictObject({
    commentable: z.boolean().optional().describe('Whether description/function.doc may be edited in the saved Profile; when false, preserve the original description; forbidden changes throw.'),
    renamable: z.boolean().optional().describe('Whether this member may be renamed in the saved Profile; when false, preserve its original name.'),
    movable: z.boolean().optional().describe('Whether this member may be moved in the saved Profile; when false, preserve its original parent and path.'),
    removable: z.boolean().optional().describe('Whether this member may be omitted from the saved Profile; when false, retain it in the Profile tree even if unused (omitting protected members throws).'),
    disableable: z.boolean().optional().describe('Whether this member may have disabled: true in the saved Profile; when false, keep it enabled.'),
    acceptsChildren: z.boolean().optional().describe('Whether new members may be added to this namespace in the saved Profile; when false, preserve its existing membership.'),
    availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional().describe('Allowed fixedLevel values in the saved Profile; an empty list means preserve the existing level.'),
});

/** @brief Shared editable node properties. */
const nodeProperties = {
    permissions: permissionSchema.optional().describe('Constraints on the saved Profile tree: retain protected members with their required names, paths and command identities. Protection belongs only to the plugin-owned tools subtree; ordinary mounted commands such as fs.* and bash are removable and are not restored when omitted. Read-only server rules returned by load; save/apply reject permissions. Defaults: commentable, renamable, movable, removable and disableable true; acceptsChildren false for functions, true for namespaces; availableFixLevels [0,1,2] for functions, [0,1] for namespaces. Omitted permissions or fields use ordinary defaults and do not imply protection; server restrictions remain authoritative.'),
    fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe('Pin level (default 0, omitted): 0 none, 1 brief, 2 detailed; allowed values come from permissions.availableFixLevels.'),
    disabled: z.boolean().optional().describe('Default false (omitted). Disabled nodes and descendants are excluded from discovery, runtime bindings, native tools, preloaded values and pinned prompts; configuration is retained for re-enabling. Disabling tools also removes tools.inspect guidance.'),
};

/** @brief Reject empty, invalid and JavaScript convention member keys before record parsing. */
const memberNameSchema = z.string().regex(/^[A-Za-z_][\w$]*$/, 'Invalid namespace member name').refine(
    name => !Object.hasOwn(Object.prototype, name) && !['prototype', 'then'].includes(name) && !name.startsWith('__'),
    'Reserved JavaScript member name');

/** @brief Recursive namespace transport with directly nested function or namespace members. */
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

/** @brief Validate function and namespace members by their discriminator. */
const nodeSchema: z.ZodType<ProfileTreeNode> = z.lazy(() => z.union([
    namespaceSchema,
    z.strictObject({
        ...nodeProperties, type: z.literal('function'),
        function: z.strictObject({ tool: z.string().describe('Exact physical tool name from tools.profile.tools, including unmounted tools; do not use a namespace path.'), doc: z.string().optional().describe('Profile-specific summary for ordinary mounts; cannot modify the original physical tool documentation or schema. Builtin tools members have server-owned documentation.') }),
    }),
]));

/** @brief Validate editable Profile input; server-owned permissions remain authoritative. */
export const ProfileSchema: z.ZodType<ProfileData> = z.strictObject({ name: z.string(), brief: z.string().optional().describe('Short description of the Profile purpose.'), root: namespaceSchema.describe("Anonymous namespace root of editable Profile data. Member names are children record keys. Server-owned node permissions govern edits.") });

/** @brief Create protected children first, then add configured mappings without replacing existing nodes. */
export function profileTree(name: string, configuration: PlaneProfileData, definitions: NamespaceDefinitions = defaultNamespaceDefinitions): ProfileDocument {
    const definition = new EditableNamespace('', configuration.providedRoot ?? definitions.tree(name));
    const nodeFor = (parts: string[]): ProfileNamespace => parts.reduce((parent, name) => {
        const node = parent.getOrCreate(name, () => new EditableNamespace(name));
        if (node.type !== 'namespace') throw new Error(`Expected namespace: ${name}`);
        return node as ProfileNamespace;
    }, definition as ProfileNamespace);
    for (const item of configuration.namespaces) nodeFor(item.path.split('.')).setDescription(item.description);
    for (const mapping of configuration.mappings) {
        const parts = mapping.path.split('.');
        const parent = nodeFor(parts.slice(0, -1));
        if (parent.get(parts.at(-1)!)) continue;
        const node = parent.create(parts.at(-1)!, () => new EditableFunction(parts.at(-1)!));
        if (node.type !== 'function') throw new Error(`Expected function: ${mapping.path}`);
        const command = (node as ProfileFunction).setTool(mapping.id);
        const description = mapping.description ?? configuration.toolComments?.[mapping.id];
        if (description !== undefined) command.setDescription(description);
    }
    const snapshot = definition.serialize();
    const initial = definitions.tree(name);
    const apply = (node: ProfileTreeNode, path: string): void => {
        const setting = settingsAt(configuration.nodeSettings, path ? path.split('.') : []);
        if (setting?.description !== undefined) {
            if (node.type === 'namespace') node.description = setting.description;
            else node.function.doc = setting.description;
        }
        const mapping = configuration.mappings.find(item => item.path === path);
        const namespace = configuration.namespaces.find(item => item.path === path);
        const permissions = path ? nodePermissions(node.type === 'function' ? 'leaf' : 'tree', { ...node.permissions, ...setting?.permissions }) : definitions.createInitialProfile().permissions;
        const declared = path.split('.').reduce<ProfileTreeNode | undefined>((parent, name) => parent?.children?.[name], path ? initial : undefined);
        const level = fixLevel(permissions, node.type === 'function' ? configuration.builtinVisible?.[path] ?? mapping?.alwaysVisible ?? (declared ? declared.fixedLevel ?? 0 : node.fixedLevel ?? 0)
            : namespace?.alwaysVisible || configuration.namespaceVisible?.[path] ? 1 : 0);
        if (node.type === 'function') node.fixedLevel = level;
        else node.fixedLevel = level === 2 ? 1 : level;
        node.permissions = permissions;
        node.disabled = permissions.disableable && (!!mapping?.disabled || !!namespace?.disabled || (configuration.builtinDisabled ?? []).includes(path));
        for (const [name, child] of Object.entries(node.children ?? {})) apply(child, path ? `${path}.${name}` : name);
    };
    apply(snapshot, '');
    return new ProfileDocument({ name, brief: configuration.brief, root: snapshot });
}

/** @brief Project an untrusted target by applying its difference through the actual root and child classes. */
export function profileConfiguration(profile: ProfileData, current: PlaneProfileData, commands: readonly ToolBrief[], definitions: NamespaceDefinitions = defaultNamespaceDefinitions): PlaneProfile {
    profile = ProfileSchema.parse(profile);
    const before = profileTree(profile.name, current, definitions).save();
    const snapshot = applyProfile(definitions.profile(before), compareProfile(profileWrite(before), profileWrite(profile)));
    snapshot.check({ commands: new Set(commands.map(command => command.name)), addition: () => ({}), original: before.root });
    return toPlaneProfile({ name: profile.name, brief: snapshot.brief, root: snapshot.serialize() }, current, definitions);
}

/** @brief Shared Profile transport definition preloaded for PTC programs. */
export const profileAnnotation = `/** @brief Physical tool identity, summary, mount paths (including disabled paths) in the current conversation Profile (empty when unmounted), and total calls across all sessions. Plugin builtins are excluded. */
interface ToolBrief { name: string; brief: string; paths: string[]; totalCalls: number; }
/** @brief Available catalog Profile names and the current conversation selection. */
interface Profiles { profiles: string[]; selected: string; }
/** @brief Server-owned constraints on edits to the saved Profile tree. Read-only metadata returned by load; save/apply reject permissions at every depth. */
interface Permission {
    /** @brief When false, preserve the original Profile description/function.doc; forbidden changes throw. */
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
 * To mount a new function, assign children.cwd = { type: 'function', function: { tool: '<exact physical name>', doc: '<one sentence>' } } on an ordinary namespace. Use an exact physical tool name from tools.profile.tools, including unmounted tools. Member names are children record keys; rename or move members by changing their keys or parent records.
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
/** @brief Physical tool mounted as a function at a named Profile member. Functions never accept children; only namespace nodes contain members. */
interface FunctionNode extends ProfileNode {
    type: 'function';
    /** @default 0 */
    fixedLevel?: 0 | 1 | 2;
    function: {
        /** @brief Exact physical name from ToolBrief.name, not a mount path or member alias (working_directory, not cwd). Builtin tools members retain server-owned identities. */
        tool: string;
        /** @brief Profile-specific summary for ordinary mounts; cannot modify the original physical tool documentation or schema. Builtin tools members have server-owned documentation. */
        /** @default Original tool brief */
        doc?: string;
    };
}
/** @brief Namespace containing directly nested Profile members keyed by name. children is a member record, not a namespace node: { files: { type: 'namespace', children: { read: { type: 'function', function: { tool: 'read' } } } } }. Empty namespaces may omit children. */
interface NamespaceTreeNode extends ProfileNode {
    type: 'namespace';
    /** @default 0 */
    fixedLevel?: 0 | 1;
    children?: Record<string, FunctionNode | NamespaceTreeNode>;
    description?: string;
}
/** @brief Named namespace configuration with an anonymous root. */
interface Profile { name: string; brief?: string; root: NamespaceTreeNode; }
/** @brief Writable function; never submit permissions. */
interface FunctionWrite extends Omit<FunctionNode, 'permissions'> {}
/** @brief Writable namespace; recursively omit permissions. */
interface NamespaceWrite extends Omit<NamespaceTreeNode, 'permissions' | 'children'> {
    children?: Record<string, FunctionWrite | NamespaceWrite>;
}
/** @brief save input. Target name is a separate argument; omit name and all permissions from load data. */
/** @brief Anonymous root has no persisted visibility, pin or description settings. */
interface ProfileRootWrite extends Omit<NamespaceWrite, 'fixedLevel' | 'disabled' | 'description'> {}
interface ProfileWrite extends Omit<Profile, 'name' | 'root'> { root: ProfileRootWrite; }
/** @brief apply input: recursively partial writable fields; null deletes optional fields or named children. Required fields cannot be deleted. */
type ProfilePatch<T = ProfileWrite> = { [K in keyof T]?: T[K] extends object | undefined ? ProfilePatch<NonNullable<T[K]>> | null : T[K] | null };

`;
