import type { Store } from '../../storage/store.js';
import { JournalStore } from '../../storage/journal_store.js';
import type { ProfileSnapshot } from './profile.js';
import type { ProfileData } from '../profile_tree.js';
import type { NamespaceDefinitions } from '../../namespace/definitions.js';

/** @brief A durable identity for one immutable anonymous Profile version. */
export class ProfileReference {
    constructor(readonly pointer: number, private readonly data: Pick<ProfileData, 'root' | 'brief'>, private readonly definitions: NamespaceDefinitions) {}

    /** @brief Return an independent editing value; changing it never changes the referenced version. */
    get snapshot(): ProfileSnapshot { return this.definitions.profile(this.data); }

    toJSON(): number { return this.pointer; }
}

/** @brief Allocate monotonically increasing identities and retain every committed anonymous snapshot. */
export class SnapshotStore {
    private journal: JournalStore;
    private pending: Promise<unknown> = Promise.resolve();
    private references = new Map<number, ProfileReference>();
    private sequence = 0;
    private loaded?: Promise<void>;

    constructor(store: Store, private readonly definitions: NamespaceDefinitions) { this.journal = new JournalStore(store, 'profile_snapshot'); }

    /** @brief Recover numbering and history before references are opened. */
    load(): Promise<void> {
        return this.loaded ??= (async () => {
            const records = await this.journal.loadEntries<unknown>();
            for (const [key, value] of records) {
                if (key === 'profile_snapshot_sequence') {
                    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid Profile snapshot sequence');
                    this.sequence = Math.max(this.sequence, value as number);
                    continue;
                }
                const pointer = Number(key.slice('profile_snapshot_'.length));
                if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new Error('Invalid Profile snapshot identity');
                const data = value as Pick<ProfileData, 'root' | 'brief'>;
                // Validate once through the declared concrete Profile classes.
                const snapshot = this.definitions.profile(data);
                this.references.set(pointer, new ProfileReference(pointer, { root: snapshot.serialize(), brief: snapshot.brief }, this.definitions));
                this.sequence = Math.max(this.sequence, pointer);
            }
        })();
    }

    /** @brief Retrieve an existing version without constructing a replacement semantic tree. */
    async get(pointer: number): Promise<ProfileReference> {
        await this.load();
        const reference = this.references.get(pointer);
        if (!reference) throw new Error(`Unknown Profile snapshot: ${pointer}`);
        return reference;
    }

    /** @brief Atomically append data and its high-water mark before publishing a new reference. */
    save(snapshot: ProfileSnapshot): Promise<ProfileReference> {
        const data = structuredClone({ root: snapshot.serialize(), brief: snapshot.brief });
        const work = this.pending.then(async () => {
            await this.load();
            if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Profile snapshot sequence exhausted');
            const pointer = ++this.sequence;
            await this.journal.commit([[`profile_snapshot_${pointer}`, data], ['profile_snapshot_sequence', pointer]]);
            const reference = new ProfileReference(pointer, data, this.definitions);
            this.references.set(pointer, reference);
            return reference;
        });
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Complete interrupted appends before the independent backend is closed. */
    flush(): Promise<void> { return this.journal.flush(); }
}
