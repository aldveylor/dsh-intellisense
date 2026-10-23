import type { Store } from '../storage/store.js';
import type { CompletionResult } from '../typescript/completion.js';

/** @brief Independent retention counts for namespace discovery and callable/argument help. */
export interface HistoryLimits { namespace: number; command: number }
export const defaultHistoryLimits: Readonly<HistoryLimits> = Object.freeze({ namespace: 3, command: 1 });

/** @brief Validate counts before updating storage or presenting the UI draft as saved. */
export function validateHistoryLimits(limits: HistoryLimits): void {
    if (!limits || !Number.isSafeInteger(limits.namespace) || limits.namespace < 0 || !Number.isSafeInteger(limits.command) || limits.command < 0) throw new Error('History counts must be non-negative safe integers');
}

/** @brief Persist global IntelliSense preferences separately from conversation profile references. */
export class CompletionSettings {
    private current: HistoryLimits = { ...defaultHistoryLimits };
    private writes: Promise<unknown> = Promise.resolve();

    constructor(private store: Store) {}

    async load(): Promise<void> {
        const saved = await this.store.load<HistoryLimits>('completion_history');
        if (saved) { validateHistoryLimits(saved); this.current = { ...saved }; }
    }

    limits(): HistoryLimits { return { ...this.current }; }

    async configure(limits: HistoryLimits): Promise<void> {
        validateHistoryLimits(limits);
        const next = { namespace: limits.namespace, command: limits.command };
        const work = this.writes.then(async () => {
            await this.store.save('completion_history', next);
            this.current = next;
        });
        this.writes = work.catch(() => {});
        await work;
    }
}

/** @brief Retain independent bounded histories while preserving interleaved discovery order. */
export class CompletionHistory {
    private entries: Array<{ kind: keyof HistoryLimits; context: string }> = [];

    push(result: CompletionResult, limits: HistoryLimits): void {
        this.entries.push({ kind: result.signatures.length ? 'command' : 'namespace', context: result.context });
        this.trim(limits);
    }

    context(limits: HistoryLimits): string {
        this.trim(limits);
        return this.entries.map(entry => entry.context).join('\n\n');
    }

    clear(): void { this.entries = []; }

    /** @brief Evict only the oldest entries of the category whose quota was exceeded. */
    private trim(limits: HistoryLimits): void {
        const retained: typeof this.entries = [];
        const counts: HistoryLimits = { namespace: 0, command: 0 };
        for (const entry of [...this.entries].reverse()) {
            if (counts[entry.kind]++ < limits[entry.kind]) retained.push(entry);
        }
        this.entries = retained.reverse();
    }
}
