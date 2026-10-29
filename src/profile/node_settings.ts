import { z } from 'zod';
import type { Permission } from './namespace/node.js';

/** @brief Recursive authoritative permission overrides, keyed only by direct member names. */
export interface ProfileNodeSettings { permissions?: Partial<Permission>; description?: string; children?: Record<string, ProfileNodeSettings> }

/** @brief Validate plugin-defined permissions before persisting an editing transaction. */
export const ProfileNodeSettingsSchema: z.ZodType<ProfileNodeSettings> = z.lazy(() => z.strictObject({
    permissions: z.strictObject({ commentable: z.boolean().optional(), renamable: z.boolean().optional(), movable: z.boolean().optional(), removable: z.boolean().optional(), disableable: z.boolean().optional(), acceptsChildren: z.boolean().optional(), availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional() }).optional(),
    description: z.string().optional(),
    children: z.record(z.string(), ProfileNodeSettingsSchema).optional(),
}));

/** @brief Follow the same recursive member chain used by the Profile tree. */
export function permissionsAt(root: ProfileNodeSettings | undefined, parts: readonly string[]): Partial<Permission> | undefined {
    for (const part of parts) root = root?.children?.[part];
    return root?.permissions;
}

/** @brief Resolve all overrides for one recursively addressed node. */
export function settingsAt(root: ProfileNodeSettings | undefined, parts: readonly string[]): ProfileNodeSettings | undefined {
    for (const part of parts) root = root?.children?.[part];
    return root;
}
