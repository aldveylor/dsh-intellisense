import { z } from 'zod';

/** @brief Validated bounds for text execution and completion continuation. */
export const Config = z.strictObject({
    marker: z.string().min(1).max(128).refine(value => !/[\r\n`]/.test(value), 'Marker must fit on one line without fences').default('<|INTELLISENSE|>'),
    maxSegments: z.number().int().min(1).default(8),
    repeatLimit: z.number().int().min(1).default(2),
    maxInfoChars: z.number().int().min(1).default(8192),
    contextChars: z.number().int().min(1).default(2048),
    maxBufferedChars: z.number().int().min(1).default(1_048_576),
    malformedPolicy: z.enum(['repair-once', 'error']).default('repair-once'),
});

/** @brief Resolved protocol configuration shared by the adapter and completion formatter. */
export type ProtocolConfig = z.output<typeof Config>;
