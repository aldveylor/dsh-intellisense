import type { SenseEvent } from './events.js';

/** @brief Validate plugin-owned completion records before consuming persisted or browser data. */
export function senseRecord(event: { type: string; data: unknown; ignorable?: boolean }): SenseEvent | undefined {
    if (event.type !== 'plugin:ts_intellisense/intellisense' || event.ignorable !== true || !event.data || typeof event.data !== 'object') return;
    const value = event.data as Partial<SenseEvent>;
    if (!Array.isArray(value.queries) || !value.queries.every(query => typeof query === 'string') || typeof value.info !== 'string' || typeof value.elapsedMs !== 'number') return;
    return value as SenseEvent;
}

