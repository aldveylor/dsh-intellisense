import { storageVersion } from '../version.js';

/** @brief Upgrade persisted counters or recover valid entries before statistics publish their state. */
export function upgradeStatisticsCheckpoint(value: unknown, recover: boolean): { data: Record<string, unknown>; migrating: boolean } {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const migrating = recover || saved.version !== storageVersion;
    if (!migrating) return { data: saved, migrating };
    const counts = saved.counts && typeof saved.counts === 'object' && !Array.isArray(saved.counts) ? saved.counts : {};
    return { data: { ...saved, version: storageVersion, counts: Object.fromEntries(Object.entries(counts)
        .filter(([, count]) => Number.isSafeInteger(count) && count >= 0)) }, migrating };
}
