import { ValidationError } from '../error.js';

/** @brief Recursively merge object fields, delete null fields and replace arrays and scalar values. */
export function mergeProfilePatch(target: unknown, patch: Record<string, unknown>): Record<string, unknown> {
    const replaced = patch.type !== undefined && target !== null && typeof target === 'object' && (target as { type?: unknown }).type !== undefined && (target as { type?: unknown }).type !== patch.type;
    const fields = new Map<string, unknown>(!replaced && target !== null && typeof target === 'object' && !Array.isArray(target) ? Object.entries(target) : []);
    for (const [key, value] of Object.entries(patch)) {
        if (!/^[A-Za-z_][\w$]*$/.test(key) || Object.hasOwn(Object.prototype, key) || ['prototype', 'then'].includes(key) || key.startsWith('__')) throw new ValidationError([{ path: key, message: `Invalid or reserved Profile patch key: ${key}` }]);
        if (value === null) fields.delete(key);
        else fields.set(key, typeof value === 'object' && !Array.isArray(value) ? mergeProfilePatch(fields.get(key), value as Record<string, unknown>) : value);
    }
    return Object.fromEntries(fields);
}
