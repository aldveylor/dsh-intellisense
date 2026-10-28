import { z } from 'zod';
import type { Store } from './store.js';

/** @brief One atomic logical transaction containing only the records being changed. */
export type JournalWrites = readonly (readonly [string, unknown])[];

const journalSchema = z.object({ version: z.literal(1), writes: z.array(z.tuple([z.string(), z.unknown()])) });

/** @brief Bind a recoverable write journal to one storage prefix under a single writer. */
export class JournalStore {
    private pending: Promise<void> = Promise.resolve();
    private unfinished?: JournalWrites;
    private readonly journalKey: string;

    constructor(private store: Store, private prefix: string) {
        if (!store.loadEntries) throw new Error('Journal storage requires loadEntries');
        if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid journal storage prefix');
        this.journalKey = `${prefix}_journal`;
    }

    /** @brief Recover an interrupted transaction before returning detached records in this scope. */
    loadEntries<T>(): Promise<[string, T][]> {
        return this.serialize(async () => {
            if (this.unfinished) await this.persist(this.unfinished);
            const entries = await this.store.loadEntries!<unknown>(this.prefix);
            const raw = entries.find(([key]) => key === this.journalKey)?.[1];
            if (raw !== undefined) {
                const journal = journalSchema.parse(raw);
                this.validate(journal.writes);
                this.unfinished = journal.writes;
                await this.persist(journal.writes);
                return (await this.store.loadEntries!<T>(this.prefix)).filter(([key]) => this.owns(key));
            }
            return entries.filter(([key]) => this.owns(key)) as [string, T][];
        });
    }

    /** @brief Commit after-images for changed records; exact replay never increments a counter twice. */
    commit(writes: JournalWrites): Promise<void> {
        this.validate(writes);
        // Detach caller values before any asynchronous work can observe a later mutation.
        const captured = structuredClone(writes);
        return this.serialize(async () => {
            if (this.unfinished) await this.persist(this.unfinished);
            if (!captured.length) return;
            this.unfinished = captured;
            await this.persist(captured);
        });
    }

    /** @brief Recover a retained failed transaction before the owner releases its backend. */
    flush(): Promise<void> { return this.serialize(async () => { if (this.unfinished) await this.persist(this.unfinished); }); }

    /** @brief Publish the journal atomically before replacing records, and delete it only after all writes succeed. */
    private async persist(writes: JournalWrites): Promise<void> {
        await this.store.save(this.journalKey, { version: 1, writes });
        for (const [key, value] of writes) await this.store.save(key, value);
        await this.store.remove(this.journalKey);
        this.unfinished = undefined;
    }

    /** @brief Restrict a journal to its own records and reject duplicate or reserved targets. */
    private validate(writes: JournalWrites): void {
        const keys = new Set<string>();
        for (const [key] of writes) {
            if (!this.owns(key) || keys.has(key)) throw new Error('Invalid journal write target');
            keys.add(key);
        }
    }

    /** @brief Keep similarly prefixed records outside this journal's ownership. */
    private owns(key: string): boolean { return (key === this.prefix || key.startsWith(`${this.prefix}_`)) && key !== this.journalKey; }

    /** @brief Serialize retries, commits, and recovery without poisoning subsequent work on failure. */
    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const work = this.pending.then(operation);
        this.pending = work.then(() => {}, () => {});
        return work;
    }
}
