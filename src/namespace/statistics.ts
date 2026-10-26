import { createHash } from 'node:crypto';
import type { Store } from '../storage/store.js';

/** @brief Per-tool dispatch counts and per-path IntelliSense query counts. */
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
}

/** @brief A normalized, resolved IntelliSense query target. */
export interface QueryTarget { path: string; namespace: boolean }

/** @brief Persist session and global counters together through serialized updates. */
export class CommandStatistics {
    private global = this.empty();
    private sessions = new Map<string, CommandCounts>();
    private pending: Promise<void> = Promise.resolve();

    constructor(private store: Store) {}

    /** @brief Restore counters before exposing the namespace service. */
    async load(): Promise<void> {
        const sessions = await this.store.load<string[]>('command_statistics_sessions') ?? [];
        const keys = sessions.map(session => this.key(session));
        const records = this.store.loadMany ? await this.store.loadMany<CommandCounts>(keys) : await Promise.all(keys.map(key => this.store.load<CommandCounts>(key)));
        this.sessions.clear();
        this.global = this.empty();
        for (const [index, session] of sessions.entries()) {
            const counts = records[index];
            if (!counts) continue;
            this.sessions.set(session, counts);
            for (const field of ['callsByTool', 'namespaceQueriesByPath', 'commandQueriesByPath'] as const) {
                for (const [key, count] of Object.entries(counts[field])) this.increment(this.global[field], key, count);
            }
        }
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
        });
    }

    /** @brief Read a durable detached global snapshot, or the specified session's snapshot. */
    async snapshot(session?: string): Promise<CommandStatisticsSnapshot> {
        await this.pending;
        const counts = structuredClone(session === undefined ? this.global : this.sessions.get(session) ?? this.empty());
        const total = (values: Record<string, number>): number => Object.values(values).reduce((sum, count) => sum + count, 0);
        return { ...counts, calls: total(counts.callsByTool), namespacesQueried: total(counts.namespaceQueriesByPath), commandsQueried: total(counts.commandQueriesByPath) };
    }

    /** @brief Commit both scopes atomically without losing concurrent dispatches or queries. */
    private update(session: string, change: (counts: CommandCounts) => void): Promise<void> {
        const work = this.pending.then(async () => {
            const next = structuredClone(this.sessions.get(session) ?? this.empty());
            change(next);
            if (!this.sessions.has(session)) await this.store.save('command_statistics_sessions', [...this.sessions.keys(), session]);
            await this.store.save(this.key(session), next);
            this.sessions.set(session, next);
            change(this.global);
        });
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Persist each session independently; global counts are derived when loading. */
    private key(session: string): string { return `command_statistics_${createHash('sha256').update(session).digest('hex')}`; }

    /** @brief Create independent counters for a new scope. */
    private empty(): CommandCounts { return { callsByTool: {}, namespaceQueriesByPath: {}, commandQueriesByPath: {} }; }

    /** @brief Safely count arbitrary physical tool names and root namespace paths. */
    private increment(counts: Record<string, number>, key: string, amount = 1): void {
        Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key]! : 0) + amount, enumerable: true, writable: true, configurable: true });
    }
}
