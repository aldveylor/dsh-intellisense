import { createHash } from 'node:crypto';
import { z } from 'zod';
import { storageVersion } from '../storage/version.js';
import type { Store } from '../storage/store.js';
import { JournalStore, type JournalWrites } from '../storage/journal_store.js';

/** @brief Per-tool dispatch counts and per-path Inspect query counts. */
export interface CommandCounts {
    callsByTool: Record<string, number>;
    namespaceQueriesByPath: Record<string, number>;
    commandQueriesByPath: Record<string, number>;
}

/** @brief Detached live counters with totals derived from their detailed counts. */
export interface CommandStatisticsSnapshot extends CommandCounts {
    calls: number;
    namespacesQueried: number;
    commandsQueried: number;
    queriesByTool: Record<string, number>;
}

/** @brief A normalized, resolved Inspect query target. */
export interface QueryTarget { path: string; namespace: boolean; tool?: string }

const fields = ['callsByTool', 'namespaceQueriesByPath', 'commandQueriesByPath'] as const;
const key = 'command_statistics';
const sessionPrefix = `${key}_session_`;
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// z.record strips __proto__; preserve valid physical tool identities as ordinary own data properties.
const counters = z.custom<Record<string, number>>(value => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(count => counter.safeParse(count).success)).transform(value => structuredClone(value));
const countsSchema = z.object({ callsByTool: counters, namespaceQueriesByPath: counters, commandQueriesByPath: counters });
const checkpointSchema = z.object({ version: z.literal(storageVersion), counts: countsSchema, queriesByTool: counters });
const sessionSchema = z.object({ version: z.literal(storageVersion), session: z.string(), counts: countsSchema });
const legacySchema = z.object({ version: z.literal(storageVersion), sessions: z.array(z.tuple([z.string(), countsSchema])), queriesByTool: counters });

/** @brief Read only record-shaped persisted data. */
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** @brief Retain independently valid counters during recovery. */
function recoverCounters(value: unknown): Record<string, number> {
    return Object.fromEntries(Object.entries(record(value)).filter(([, value]) => counter.safeParse(value).success)) as Record<string, number>;
}

/** @brief Restore independently valid fields without inventing counters. */
function recoverCounts(value: unknown): CommandCounts {
    const saved = record(value);
    return { callsByTool: recoverCounters(saved.callsByTool), namespaceQueriesByPath: recoverCounters(saved.namespaceQueriesByPath), commandQueriesByPath: recoverCounters(saved.commandQueriesByPath) };
}

/** @brief Recover independently valid legacy session counters during initial migration. */
function recoverSessions(value: unknown): [string, CommandCounts][] {
    return [...new Map((Array.isArray(value) ? value : []).flatMap(entry => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object' || Array.isArray(entry[1])) return [];
        return [[entry[0], recoverCounts(entry[1])] as [string, CommandCounts]];
    }))];
}

/** @brief Increment only touched counters and schedule dirty records for journal-backed storage. */
export class CommandStatistics {
    private global = this.empty();
    private queriesByTool: Record<string, number> = {};
    private sessions = new Map<string, CommandCounts>();
    private dirty = new Set<string>();
    private timer?: ReturnType<typeof setTimeout>;
    private pending: Promise<void> = Promise.resolve();
    private loading: Promise<void> = Promise.resolve();
    private disposed = false;
    private storage: JournalStore;

    constructor(private store: Store, private options: { flushDelayMs?: number; onError?: (error: unknown) => void } = {}) {
        this.storage = new JournalStore(store, key);
        const delay = options.flushDelayMs ?? 1000;
        if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2_147_483_647) throw new Error('Invalid statistics flush delay');
    }

    /** @brief Serialize reloads with writes, retaining accepted dirty updates before replacing live state. */
    load(recover = false): Promise<void> {
        this.cancelTimer();
        const work = this.pending.then(async () => { await this.saveDirty(); await this.loadSnapshot(recover); });
        this.pending = work.catch(() => {});
        this.loading = this.pending;
        void work.finally(() => this.schedule()).catch(() => {});
        return work;
    }

    /** @brief Read recovered storage records without recomputing global totals from sessions. */
    private async loadSnapshot(recover: boolean): Promise<void> {
        const entries = new Map(await this.storage.loadEntries<unknown>());
        const raw = entries.get(key);
        const saved = record(raw);
        let global: z.infer<typeof checkpointSchema>;
        const sessions = new Map<string, CommandCounts>();
        const rewrites: Array<[string, unknown]> = [];
        if (raw !== undefined && !Object.hasOwn(saved, 'counts')) {
            const legacy = recover || saved.version !== storageVersion
                ? { version: storageVersion, sessions: recoverSessions(saved.sessions), queriesByTool: recoverCounters(saved.queriesByTool) }
                : legacySchema.parse(raw);
            global = { version: storageVersion, counts: this.empty(), queriesByTool: legacy.queriesByTool };
            for (const [session, counts] of new Map(legacy.sessions)) {
                sessions.set(session, counts);
                rewrites.push([this.sessionKey(session), { version: storageVersion, session, counts }]);
                this.addCounts(global.counts, counts);
            }
            const retained = new Set([...sessions.keys()].map(session => this.sessionKey(session)));
            for (const name of entries.keys()) if (name.startsWith(sessionPrefix) && !retained.has(name)) await this.store.remove(name);
            rewrites.push([key, global]);
        } else {
            global = raw === undefined ? { version: storageVersion, counts: this.empty(), queriesByTool: {} }
                : recover || saved.version !== storageVersion
                    ? { version: storageVersion, counts: recoverCounts(saved.counts), queriesByTool: recoverCounters(saved.queriesByTool) }
                    : checkpointSchema.parse(raw);
            for (const [name, value] of entries) {
                if (!name.startsWith(sessionPrefix)) continue;
                const data = record(value);
                const migrate = recover || data.version !== storageVersion;
                if (migrate && typeof data.session !== 'string') { await this.store.remove(name); continue; }
                const checkpoint = migrate ? sessionSchema.parse({ version: storageVersion, session: data.session, counts: recoverCounts(data.counts) }) : sessionSchema.parse(value);
                if (this.sessionKey(checkpoint.session) !== name) {
                    if (!migrate) throw new Error('Invalid statistics session key');
                    await this.store.remove(name);
                    continue;
                }
                sessions.set(checkpoint.session, checkpoint.counts);
                if (migrate) rewrites.push([name, checkpoint]);
            }
            if (raw !== undefined && (recover || saved.version !== storageVersion)) rewrites.push([key, global]);
        }
        if (rewrites.length) await this.storage.commit(rewrites);
        this.global = global.counts;
        this.queriesByTool = global.queriesByTool;
        this.sessions = sessions;
    }

    /** @brief Count one dispatch attempt immediately without awaiting storage IO. */
    recordCall(session: string, tool: string): Promise<void> {
        const delta = this.empty();
        this.increment(delta.callsByTool, tool);
        return this.update(session, delta);
    }

    /** @brief Count resolved occurrences and physical tool identities in the same memory update. */
    recordQueries(session: string, targets: readonly QueryTarget[]): Promise<void> {
        if (!targets.length) return Promise.resolve();
        const delta = this.empty();
        const queries: Record<string, number> = {};
        for (const target of targets) {
            this.increment(target.namespace ? delta.namespaceQueriesByPath : delta.commandQueriesByPath, target.path);
            if (!target.namespace && target.tool) this.increment(queries, target.tool);
        }
        return this.update(session, delta, queries);
    }

    /** @brief Return detached live counters, including dirty updates awaiting delayed persistence. */
    async snapshot(session?: string): Promise<CommandStatisticsSnapshot> {
        await this.loading;
        const counts = structuredClone(session === undefined ? this.global : this.sessions.get(session) ?? this.empty());
        const total = (values: Record<string, number>): number => Object.values(values).reduce((sum, count) => sum + count, 0);
        return { ...counts, queriesByTool: session === undefined ? structuredClone(this.queriesByTool) : {}, calls: total(counts.callsByTool), namespacesQueried: total(counts.namespaceQueriesByPath), commandsQueried: total(counts.commandQueriesByPath) };
    }

    /** @brief Validate every touched counter before atomically publishing the delta in memory. */
    private async update(session: string, delta: CommandCounts, queries: Record<string, number> = {}): Promise<void> {
        await this.loading;
        if (this.disposed) throw new Error('Statistics are disposed');
        const counts = this.sessions.get(session) ?? this.empty();
        for (const target of [counts, this.global]) for (const field of fields) this.validateAdd(target[field], delta[field]);
        this.validateAdd(this.queriesByTool, queries);
        this.addCounts(counts, delta);
        this.addCounts(this.global, delta);
        this.addCounters(this.queriesByTool, queries);
        this.sessions.set(session, counts);
        this.dirty.add(session);
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

    /** @brief Freeze only dirty session records and restore dirty flags on failed storage commits. */
    private async saveDirty(): Promise<void> {
        await this.storage.flush();
        if (!this.dirty.size) return;
        const dirty = this.dirty;
        const writes: JournalWrites = [
            ...[...dirty].map(session => [this.sessionKey(session), { version: storageVersion, session, counts: this.sessions.get(session)! }] as const),
            [key, { version: storageVersion, counts: this.global, queriesByTool: this.queriesByTool }],
        ];
        this.dirty = new Set();
        try { await this.storage.commit(writes); }
        catch (error) { for (const session of dirty) this.dirty.add(session); throw error; }
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
        }, this.options.flushDelayMs ?? 1000);
        this.timer.unref();
    }

    /** @brief Cancel the scheduled save before flushing, reload, or shutdown. */
    private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

    /** @brief Stop scheduling and drain accepted updates before releasing the backend. */
    async dispose(): Promise<void> { this.disposed = true; this.cancelTimer(); await this.flush(); }

    /** @brief Hash arbitrary conversation identities into safe storage keys. */
    private sessionKey(session: string): string { return sessionPrefix + createHash('sha256').update(session).digest('hex'); }

    /** @brief Create independent counter records for one scope. */
    private empty(): CommandCounts { return { callsByTool: {}, namespaceQueriesByPath: {}, commandQueriesByPath: {} }; }

    /** @brief Reject overflow before publishing any part of an increment. */
    private validateAdd(target: Record<string, number>, delta: Record<string, number>): void {
        for (const [name, amount] of Object.entries(delta)) counter.parse((Object.hasOwn(target, name) ? target[name]! : 0) + amount);
    }

    /** @brief Apply only fields present in a delta without scanning other sessions. */
    private addCounts(target: CommandCounts, delta: CommandCounts): void { for (const field of fields) this.addCounters(target[field], delta[field]); }

    /** @brief Apply one counter delta while preserving arbitrary physical tool names. */
    private addCounters(target: Record<string, number>, delta: Record<string, number>): void {
        for (const [name, amount] of Object.entries(delta)) this.increment(target, name, amount);
    }

    /** @brief Safely increment root paths and prototype-like physical tool identities. */
    private increment(counts: Record<string, number>, name: string, amount = 1): void {
        Object.defineProperty(counts, name, { value: counter.parse((Object.hasOwn(counts, name) ? counts[name]! : 0) + amount), enumerable: true, writable: true, configurable: true });
    }
}
