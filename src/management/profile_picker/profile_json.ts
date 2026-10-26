import { z } from 'zod';

/** @brief Shared JSON Profile configuration validation for uploads and management writes. */
const mapping = z.strictObject({ id: z.string().min(1), path: z.string().min(1), description: z.string().optional(), pinned: z.boolean(), disabled: z.boolean().optional(), alwaysVisible: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional() });
const visibility = z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2)]));
export const profileConfiguration = {
    brief: z.string().optional(),
    mappings: z.array(mapping),
    namespaces: z.array(z.strictObject({ path: z.string(), description: z.string(), alwaysVisible: z.boolean(), disabled: z.boolean().optional() })),
    builtinDisabled: z.array(z.string()).optional(), order: z.array(z.string()), unmountedVisible: visibility, builtinVisible: visibility,
    namespaceVisible: z.record(z.string(), z.boolean()), toolComments: z.record(z.string(), z.string()),
};

/** @brief Validate a complete uploaded configuration before replacing editor state. */
export function parseProfileJson(text: string) {
    return z.strictObject(profileConfiguration).parse(JSON.parse(text.replace(/^\uFEFF/, '')));
}
