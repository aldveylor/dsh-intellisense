import { z } from 'zod';
import type { ProfileNodeSettings } from '../node_settings.js';

/** @brief Validate plugin-defined permissions before persisting an editing transaction. */
export const ProfileNodeSettingsSchema: z.ZodType<ProfileNodeSettings> = z.lazy(() => z.strictObject({
    permissions: z.strictObject({ commentable: z.boolean().optional(), renamable: z.boolean().optional(), movable: z.boolean().optional(), removable: z.boolean().optional(), disableable: z.boolean().optional(), acceptsChildren: z.boolean().optional(), availableFixLevels: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional() }).optional(),
    description: z.string().optional(),
    children: z.record(z.string(), ProfileNodeSettingsSchema).optional(),
}));
