import { version } from './version.js';
import type { DshCompatibility } from './contracts.js';

/** @brief Load only the host version's adapter, keeping new executor packages optional on old hosts. */
export const dshCompatibility: DshCompatibility = (await (version.gte('0.2.2-alpha.2', () => import('./executor.js'))
    ?? import('./legacy.js'))).compatibility;
