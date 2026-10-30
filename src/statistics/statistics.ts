import { createHash } from 'node:crypto';
import { z } from 'zod';
import { storageVersion } from '../storage/version.js';
import type { Store } from '../storage/store.js';
import { JournalStore, type JournalWrites } from '../storage/journal_store.js';
import { upgradeStatisticsCheckpoint } from '../storage/compatibility/statistics.js';

/** @brief Detached counters indexed by names chosen by their owner. */
export type Counts = Record<string, number>;

/** @brief A scoped view of a counter collection. */
export interface Counter {
    /** @brief Increment occurrences atomically in this scope and the global collection. */
    increment(names: readonly string[]): Promise<void>;
    /** @brief Read detached live counters. */
    snapshot(): Promise<Counts>;
}

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counters = z.custom<Counts>(value => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(count => counter.safeParse(count).success)).transform(value => structuredClone(value));
const checkpointSchema = z.object({ version: z.literal(storageVersion), counts: counters });
const scopeSchema = checkpointSchema.extend({ scope: z.string() });

/** @brief Increment only touched counters and schedule dirty records for journal-backed storage. */
export class Statistics {
    private global: Counts = {};
    private scopes = new Map<string, Counts>();
    private dirty = new Set<string>();
    private timer?: ReturnType<typeof setTimeout>;
    private pending: Promise<void> = Promise.resolve();
    private loading: Promise<void> = Promise.resolve();
    private disposed = false;
    private storage: JournalStore;

    constructor(private store: Store, private key: string, private options: { flushDelayMs?: number; onError?: (error: unknown) => void } = {}) {
        this.storage = new JournalStore(store, key);
        const delay = options.flushDelayMs ?? 30_000;
        if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2_147_483_647) throw new Error('Invalid statistics flush delay');
    }

    /** @brief Serialize reloads with writes, retaining accepted dirty updates before replacing live state. */
    load(recover: boolean | 'reset' = false): Promise<void> {
        this.cancelTimer();
        const work = this.pending.then(async () => {
            if (recover === 'reset') {
                this.dirty.clear();
                await this.storage.discard();
                for (const [key] of await this.store.loadEntries!<unknown>(this.key)) {
                    if (key === this.key || key.startsWith(`${this.key}_`)) await this.store.remove(key);
                }
            } else await this.saveDirty();
            await this.loadSnapshot(!!recover);
        });
        this.pending = work.catch(() => {});
        this.loading = this.pending;
        void work.finally(() => this.schedule()).catch(() => {});
        return work;
    }

    /** @brief Load independent scope checkpoints and their global aggregate. */
    private async loadSnapshot(recover: boolean): Promise<void> {
        const entries = new Map(await this.storage.loadEntries<unknown>(recover));
        const scopes = new Map<string, Counts>();
        const rewrites: Array<[string, unknown]> = [];
        let global: Counts = {};
        for (const [name, value] of entries) {
            const { data, migrating: migrate } = upgradeStatisticsCheckpoint(value, recover);
            if (name === this.key) global = checkpointSchema.parse(data).counts;
            else {
                if (migrate && typeof data.scope !== 'string') { await this.store.remove(name); continue; }
                const checkpoint = scopeSchema.parse(data);
                if (this.scopeKey(checkpoint.scope) !== name) {
                    if (!migrate) throw new Error('Invalid statistics scope key');
                    await this.store.remove(name);
                    continue;
                }
                scopes.set(checkpoint.scope, checkpoint.counts);
            }
            if (migrate) rewrites.push([name, data]);
        }
        if (rewrites.length) await this.storage.commit(rewrites);
        this.global = global;
        this.scopes = scopes;
    }

    /** @brief Bind a counter to an owner-defined scope. */
    scope(scope: string): Counter {
        return { increment: names => this.increment(scope, names), snapshot: () => this.snapshot(scope) };
    }

    /** @brief Return detached live counters, including dirty updates awaiting persistence. */
    async snapshot(scope?: string): Promise<Counts> {
        await this.loading;
        return structuredClone(scope === undefined ? this.global : this.scopes.get(scope) ?? {});
    }

    /** @brief Validate all touched counters before publishing any increment. */
    async increment(scope: string, names: readonly string[]): Promise<void> {
        await this.loading;
        if (this.disposed) throw new Error('Statistics are disposed');
        if (!names.length) return;
        const delta: Counts = {};
        for (const name of names) this.add(delta, name, 1);
        const counts = this.scopes.get(scope) ?? {};
        for (const target of [counts, this.global]) this.validateAdd(target, delta);
        for (const target of [counts, this.global]) for (const [name, amount] of Object.entries(delta)) this.add(target, name, amount);
        this.scopes.set(scope, counts);
        this.dirty.add(scope);
        this.schedule();
    }

    /** @brief Flush accepted updates explicitly; a clean flush performs no storage operations. */
    flush(): Promise<void> {
        this.cancelTimer();
        const work = this.pending.then(() => this.saveDirty());
        this.pending = work.catch(() => {});
        void work.finally(() => this.schedule()).catch(() => {});
        return work;
    }

    /** @brief Freeze only dirty scope records and restore dirty flags on failed storage commits. */
    private async saveDirty(): Promise<void> {
        await this.storage.flush();
        if (!this.dirty.size) return;
        const dirty = this.dirty;
        const writes: JournalWrites = [
            ...[...dirty].map(scope => [this.scopeKey(scope), { version: storageVersion, scope, counts: this.scopes.get(scope)! }] as const),
            [this.key, { version: storageVersion, counts: this.global }],
        ];
        this.dirty = new Set();
        try { await this.storage.commit(writes); }
        catch (error) { for (const scope of dirty) this.dirty.add(scope); throw error; }
    }

    /** @brief Keep one timer handle, preserve its deadline, and retry failed dirty writes. */
    private schedule(): void {
        if (this.disposed || this.timer || !this.dirty.size) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush().catch(error => {
                if (this.options.onError) this.options.onError(error);
                else console.error('Statistics persistence failed; dirty data will be retried.', error);
            });
        }, this.options.flushDelayMs ?? 30_000);
        this.timer.unref();
    }

    /** @brief Cancel the scheduled save before flushing, reload, or shutdown. */
    private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

    /** @brief Stop scheduling and drain accepted updates before releasing the backend. */
    async dispose(): Promise<void> { this.disposed = true; this.cancelTimer(); await this.flush(); }

    /** @brief Hash arbitrary scope identities into safe storage keys. */
    private scopeKey(scope: string): string { return `${this.key}_scope_${createHash('sha256').update(scope).digest('hex')}`; }

    /** @brief Reject overflow before publishing any part of an increment. */
    private validateAdd(target: Counts, delta: Counts): void {
        for (const [name, amount] of Object.entries(delta)) counter.parse((Object.hasOwn(target, name) ? target[name]! : 0) + amount);
    }

    /** @brief Preserve root names and prototype-like identities as own properties. */
    private add(counts: Counts, name: string, amount: number): void {
        Object.defineProperty(counts, name, { value: counter.parse((Object.hasOwn(counts, name) ? counts[name]! : 0) + amount), enumerable: true, writable: true, configurable: true });
    }
}
