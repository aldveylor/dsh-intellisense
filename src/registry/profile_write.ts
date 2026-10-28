import { z } from 'zod';
import type { CommandNode, NamespaceTreeNode, ProfileTreeNode } from './profile_node.js';
import type { ProfileData } from './profile_tree.js';
import { ValidationError } from '../error.js';

/** @brief Writable command data; permissions belong exclusively to the server. */
export interface CommandWrite extends Omit<CommandNode, 'permissions'> {}

/** @brief Writable namespace with recursively writable members. */
export interface NamespaceWrite extends Omit<NamespaceTreeNode, 'permissions' | 'children'> {
    children?: Record<string, CommandWrite | NamespaceWrite>;
}

/** @brief Save input; the target name is a separate argument, never editable tree data. */
export interface ProfileWrite extends Omit<ProfileData, 'name' | 'root'> { root: ProfileRootWrite }

/** @brief Anonymous root persists only its type and children, without node preferences. */
export interface ProfileRootWrite extends Omit<NamespaceWrite, 'fixedLevel' | 'disabled' | 'description'> {}

/** @brief Recursive partial write input; null deletes optional fields or named members. */
export type ProfilePatch<T = ProfileWrite> = { [K in keyof T]?: T[K] extends object | undefined ? ProfilePatch<NonNullable<T[K]>> | null : T[K] | null };

const common = { fixedLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(), disabled: z.boolean().optional() };
/** @brief Strict writable node schema selected by its type discriminator. */
const nodeSchema: z.ZodType<CommandWrite | NamespaceWrite> = z.lazy(() => z.discriminatedUnion('type', [
    z.strictObject({ ...common, type: z.literal('command'), command: z.strictObject({ tool: z.string(), doc: z.string().optional() }) }),
    z.strictObject({ ...common, fixedLevel: z.union([z.literal(0), z.literal(1)]).optional(), type: z.literal('namespace'), description: z.string().optional(), children: z.record(z.string(), nodeSchema).optional() }),
]));

/** @brief Validate save data without accepting readonly name or permissions at any depth. */
export const ProfileWriteSchema: z.ZodType<ProfileWrite> = z.strictObject({ brief: z.string().optional(), root: z.strictObject({ type: z.literal('namespace'), children: z.record(z.string(), nodeSchema).optional() }).describe('Writable namespace root. Name and permissions are read-only server metadata: omit them recursively from load output. Only type and children are writable at the anonymous root; root-level fixedLevel, disabled and description are not persisted and are forbidden. Server restrictions on protected members remain authoritative.') });

/** @brief Reject readonly and unknown patch fields before deletion or merging can hide them. */
export function validateProfilePatch(value: Record<string, unknown>): void {
    const check = (object: Record<string, unknown>, allowed: string[], path: string, kind: 'profile' | 'root' | 'node' | 'children' | 'command'): void => {
        for (const [key, child] of Object.entries(object)) {
            const at = path ? `${path}.${key}` : key;
            if (kind !== 'children' && !allowed.includes(key)) throw new ValidationError([{ path: at, message: 'Unknown or read-only field' }]);
            if (child === null && ['root', 'type', 'command', 'tool'].includes(key) && kind !== 'children') throw new ValidationError([{ path: at, message: 'Required field cannot be deleted (received null)' }]);
            if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
            if (key === 'root' && kind === 'profile') check(child as Record<string, unknown>, ['type', 'children'], at, 'root');
            else if (kind === 'children') check(child as Record<string, unknown>, ['type', 'fixedLevel', 'disabled', 'description', 'children', 'command'], at, 'node');
            else if (key === 'children') check(child as Record<string, unknown>, [], at, 'children');
            else if (key === 'command') check(child as Record<string, unknown>, ['tool', 'doc'], at, 'command');
        }
    };
    check(value, ['brief', 'root'], '', 'profile');
}

/** @brief Explicit projection for callers saving a loaded tree; no readonly fields are submitted. */
export function profileWrite(profile: ProfileData): ProfileWrite {
    const copy = (node: ProfileTreeNode): CommandWrite | NamespaceWrite => {
        const { permissions: _permissions, children, ...data } = node;
        return { ...data, ...(children ? { children: Object.fromEntries(Object.entries(children).map(([name, child]) => [name, copy(child)])) } : {}) } as CommandWrite | NamespaceWrite;
    };
    const { type, children } = copy(profile.root) as NamespaceWrite;
    return { ...(profile.brief === undefined ? {} : { brief: profile.brief }), root: { type, ...(children ? { children } : {}) } };
}
