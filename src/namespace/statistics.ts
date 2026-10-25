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
    private state: { global: CommandCounts; sessions: Record<string, CommandCounts> } = { global: this.empty(), sessions: {} };
    private pending: Promise<void> = Promise.resolve();

    constructor(private store: Store) {}

    /** @brief Restore counters before exposing the namespace service. */
    async load(): Promise<void> {
        this.state = await this.store.load<typeof this.state>('command_statistics') ?? this.state;
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
        const counts = structuredClone(session === undefined ? this.state.global : Object.hasOwn(this.state.sessions, session) ? this.state.sessions[session]! : this.empty());
        const total = (values: Record<string, number>): number => Object.values(values).reduce((sum, count) => sum + count, 0);
        return { ...counts, calls: total(counts.callsByTool), namespacesQueried: total(counts.namespaceQueriesByPath), commandsQueried: total(counts.commandQueriesByPath) };
    }

    /** @brief Commit both scopes atomically without losing concurrent dispatches or queries. */
    private update(session: string, change: (counts: CommandCounts) => void): Promise<void> {
        const work = this.pending.then(async () => {
            const next = structuredClone(this.state);
            if (!Object.hasOwn(next.sessions, session)) Object.defineProperty(next.sessions, session, { value: this.empty(), enumerable: true, writable: true, configurable: true });
            change(next.global);
            change(next.sessions[session]!);
            await this.store.save('command_statistics', next);
            this.state = next;
        });
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Create independent counters for a new scope. */
    private empty(): CommandCounts { return { callsByTool: {}, namespaceQueriesByPath: {}, commandQueriesByPath: {} }; }

    /** @brief Safely count arbitrary physical tool names and root namespace paths. */
    private increment(counts: Record<string, number>, key: string): void {
        Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key]! : 0) + 1, enumerable: true, writable: true, configurable: true });
    }
}
