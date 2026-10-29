import type { Permission } from './namespace/node.js';

/** @brief Recursive authoritative permission overrides, keyed only by direct member names. */
export interface ProfileNodeSettings { permissions?: Partial<Permission>; description?: string; children?: Record<string, ProfileNodeSettings> }

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
