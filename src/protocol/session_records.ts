import type { SenseEvent, RewriteEvent } from './events.js';

/** @brief Validate plugin-owned completion records before consuming persisted or browser data. */
export function senseRecord(event: { type: string; data: unknown; ignorable?: boolean }): SenseEvent | undefined {
    if (event.type !== 'plugin:ts_intellisense/intellisense' || event.ignorable !== true || !event.data || typeof event.data !== 'object') return;
    const value = event.data as Partial<SenseEvent>;
    if (typeof value.prefix !== 'string' || typeof value.info !== 'string' || typeof value.injected !== 'string' || typeof value.marker !== 'string' || typeof value.elapsedMs !== 'number') return;
    return value as SenseEvent;
}

/** @brief Accept terminal protocol failures only when their durable error details are valid. */
export function failureRecord(event: { type: string; data: unknown; ignorable?: boolean }): RewriteEvent | undefined {
    if (event.type !== 'plugin:ts_intellisense/rewrite' || event.ignorable !== true || !event.data || typeof event.data !== 'object') return;
    const value = event.data as Partial<RewriteEvent>;
    if (value.reason !== 'error' || !value.failure || typeof value.failure.code !== 'string' || typeof value.failure.message !== 'string') return;
    return value as RewriteEvent;
}
