import { Statistics } from './statistics.js';
import type { Store } from '../storage/store.js';

/** @brief Own independent tool-name counters for command dispatch and discovery. */
export class CommandStatistics {
    readonly calls: Statistics;
    readonly queries: Statistics;

    constructor(store: Store, options: { flushDelayMs?: number; onError?: (error: unknown) => void } = {}) {
        this.calls = new Statistics(store, 'command_calls', options);
        this.queries = new Statistics(store, 'command_queries', options);
    }

    /** @brief Load both counter collections. */
    async load(recover = false): Promise<void> { await Promise.all([this.calls.load(recover), this.queries.load(recover)]); }

    /** @brief Persist pending increments in both collections. */
    async flush(): Promise<void> { await Promise.all([this.calls.flush(), this.queries.flush()]); }

    /** @brief Drain both collections before releasing storage. */
    async dispose(): Promise<void> { await Promise.all([this.calls.dispose(), this.queries.dispose()]); }
}
