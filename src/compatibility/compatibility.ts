import { apiGeneration } from './version.js';
import type { DshCompatibility } from './contracts.js';

/** @brief Load only the host version's adapter, keeping new executor packages optional on old hosts. */
export const dshCompatibility: DshCompatibility = (apiGeneration === 'executor'
    ? await import('./executor.js')
    : await import('./legacy.js')).compatibility;
