import { z } from 'zod';
import { storageVersion } from '../storage/version.js';
import type { Store } from '../storage/store.js';

/** @brief Per-tool dispatch counts and per-path Inspect query counts. */
export interface CommandCounts {
    callsByTool: Record<string, number>;
    namespaceQueriesByPath: Record<string, number>;
    commandQueriesByPath: Record<string, number>;
}

/** @brief Detached counters with totals derived from their detailed counts. */
export interface CommandStatisticsSnapshot extends CommandCounts {
    calls: number;
    namespacesQueried: number;
    commandsQueried: number;
    queriesByTool: Record<string, number>;
}

/** @brief A normalized, resolved Inspect query target. */
export interface QueryTarget { path: string; namespace: boolean; tool?: string }

/** @brief Validate persisted counters before exposing them to aggregation. */
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counters = z.record(z.string(), counter);
const countsSchema = z.object({ callsByTool: counters, namespaceQueriesByPath: counters, commandQueriesByPath: counters });
const statisticsSchema = z.object({ version: z.literal(storageVersion), sessions: z.array(z.tuple([z.string(), countsSchema])), queriesByTool: counters });

/** @brief Read only plain record-shaped persisted data. */
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** @brief Retain independently valid counters during version recovery. */
function recoverCounters(value: unknown): Record<string, number> {
    return Object.fromEntries(Object.entries(record(value)).filter(([, value]) => counter.safeParse(value).success)) as Record<string, number>;
}

/** @brief Persist session and global counters together through serialized updates. */
export class CommandStatistics {
    private global = this.empty();
    private queriesByTool: Record<string, number> = {};
    private sessions = new Map<string, CommandCounts>();
    private pending: Promise<void> = Promise.resolve();
    private batch?: { changes: Array<{ session: string; change: (counts: CommandCounts) => void; targets: readonly QueryTarget[] }>; work: Promise<void> };

    constructor(private store: Store) {}

    /** @brief Restore counters before exposing the namespace service. */
    load(recover = false): Promise<void> {
        const work = this.pending.then(() => this.loadSnapshot(recover));
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Validate or recover a snapshot without racing pending counter writes. */
    private async loadSnapshot(recover: boolean): Promise<void> {
        const raw = await this.store.load<unknown>('command_statistics');
        if (raw === undefined) return;
        const saved = record(raw);
        const migrate = recover || saved.version !== storageVersion;
        let data: z.infer<typeof statisticsSchema>;
        if (migrate) {
            const sessions: [string, CommandCounts][] = [];
            for (const entry of Array.isArray(saved.sessions) ? saved.sessions : []) {
                if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object' || Array.isArray(entry[1])) continue;
                const counts = record(entry[1]);
                sessions.push([entry[0], { callsByTool: recoverCounters(counts.callsByTool), namespaceQueriesByPath: recoverCounters(counts.namespaceQueriesByPath), commandQueriesByPath: recoverCounters(counts.commandQueriesByPath) }]);
            }
            data = { version: storageVersion, sessions: [...new Map(sessions)], queriesByTool: recoverCounters(saved.queriesByTool) };
        } else data = statisticsSchema.parse(raw);
        const global = this.empty();
        for (const counts of new Map(data.sessions).values()) {
            for (const field of ['callsByTool', 'namespaceQueriesByPath', 'commandQueriesByPath'] as const) {
                for (const [key, count] of Object.entries(counts[field])) this.increment(global[field], key, count);
            }
        }
        if (migrate) await this.store.save('command_statistics', data);
        this.queriesByTool = data.queriesByTool;
        this.sessions = new Map(data.sessions);
        this.global = global;
    }

    /** @brief Count one dispatch attempt, including native failures. */
    recordCall(session: string, tool: string): Promise<void> {
        return this.update(session, counts => this.increment(counts.callsByTool, tool));
    }

    /** @brief Count every resolved query occurrence; repeated targets remain separate queries. */
    recordQueries(session: string, targets: readonly QueryTarget[]): Promise<void> {
        if (!targets.length) return Promise.resolve();
        return this.update(session, counts => {
            for (const target of targets) this.increment(target.namespace ? counts.namespaceQueriesByPath : counts.commandQueriesByPath, target.path);
        }, targets);
    }

    /** @brief Read a durable detached global snapshot, or the specified session's snapshot. */
    async snapshot(session?: string): Promise<CommandStatisticsSnapshot> {
        await this.pending;
        const counts = structuredClone(session === undefined ? this.global : this.sessions.get(session) ?? this.empty());
        const total = (values: Record<string, number>): number => Object.values(values).reduce((sum, count) => sum + count, 0);
        return { ...counts, queriesByTool: session === undefined ? structuredClone(this.queriesByTool) : {}, calls: total(counts.callsByTool), namespacesQueried: total(counts.namespaceQueriesByPath), commandsQueried: total(counts.commandQueriesByPath) };
    }

    /** @brief Commit both scopes atomically without losing concurrent dispatches or queries. */
    private update(session: string, change: (counts: CommandCounts) => void, targets: readonly QueryTarget[] = []): Promise<void> {
        if (this.batch) {
            this.batch.changes.push({ session, change, targets });
            return this.batch.work;
        }
        const changes = [{ session, change, targets }];
        const work = this.pending.then(async () => {
            this.batch = undefined;
            const sessions = new Map(this.sessions);
            const global = structuredClone(this.global);
            const queriesByTool = structuredClone(this.queriesByTool);
            for (const { session, change, targets } of changes) {
                const next = structuredClone(sessions.get(session) ?? this.empty());
                change(next);
                sessions.set(session, next);
                change(global);
                for (const target of targets) if (!target.namespace && target.tool) this.increment(queriesByTool, target.tool);
            }
            await this.store.save('command_statistics', { version: storageVersion, sessions: [...sessions], queriesByTool });
            this.sessions = sessions;
            this.global = global;
            this.queriesByTool = queriesByTool;
        });
        this.batch = { changes, work };
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Create independent counters for a new scope. */
    private empty(): CommandCounts { return { callsByTool: {}, namespaceQueriesByPath: {}, commandQueriesByPath: {} }; }

    /** @brief Safely count arbitrary physical tool names and root namespace paths. */
    private increment(counts: Record<string, number>, key: string, amount = 1): void {
        Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key]! : 0) + amount, enumerable: true, writable: true, configurable: true });
    }
}
