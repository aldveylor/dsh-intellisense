import { clearStore, type Store } from '../storage/store.js';
import { JournalStore } from '../storage/journal_store.js';
import type { ProfileSnapshot, ProfileVersion } from './profile.js';
import { ProfileSchema, type ProfileData } from './catalog/profile_tree.js';
import { recoverProfile } from './catalog/recover_profile.js';
import { upgradeProfileNodes } from '../storage/compatibility/profile_compatibility.js';
import type { NamespaceDefinitions } from './namespace/definitions.js';

/** @brief A numeric identity and immutable anonymous Profile; editing values are always detached. */
export class ProfileReference implements ProfileVersion {
    private readonly template: ProfileSnapshot;

    constructor(readonly pointer: number, private readonly data: Pick<ProfileData, 'root' | 'brief'>, definitions: NamespaceDefinitions) {
        this.data = structuredClone(data);
        this.template = definitions.profile(this.data);
        Object.freeze(this);
    }

    /** @brief Return a detached value for global editing; it cannot modify the referenced snapshot. */
    get snapshot(): ProfileSnapshot { return this.template.clone(this.data); }

    /** @brief Export anonymous data without exposing the stored value to mutation. */
    serialize(): Pick<ProfileData, 'root' | 'brief'> { return structuredClone(this.data); }

    toJSON(): number { return this.pointer; }
}

/** @brief Allocate version numbers globally and archive only versions actually referenced by sessions. */
export class SnapshotStore {
    private journal: JournalStore;
    private pending: Promise<unknown> = Promise.resolve();
    private references = new Map<number, ProfileVersion>();
    private sequence = 0;
    private loaded?: Promise<void>;

    constructor(private store: Store, private readonly definitions: NamespaceDefinitions) { this.journal = new JournalStore(store, 'profile_snapshot'); }

    /** @brief Recover the counter and archived versions before opening references. */
    load(recover = false): Promise<void> {
        if (recover) this.loaded = undefined;
        return this.loaded ??= (async () => {
            const records = await this.journal.loadEntries<unknown>(recover);
            const upgrades: [string, unknown][] = [];
            const references = new Map<number, ProfileVersion>();
            let sequence = 0;
            for (const [key, value] of records) {
                try {
                    if (key === 'profile_snapshot_sequence') {
                        if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid Profile snapshot sequence');
                        sequence = Math.max(sequence, value as number);
                        continue;
                    }
                    const pointer = Number(key.slice('profile_snapshot_'.length));
                    if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new Error('Invalid Profile snapshot identity');
                    sequence = Math.max(sequence, pointer);
                    const data = value as Pick<ProfileData, 'root' | 'brief'>;
                    let upgraded = { ...data, root: upgradeProfileNodes(data?.root) as ProfileData['root'] };
                    if (recover) upgraded = recoverProfile(upgraded, this.definitions.createInitialProfile());
                    ProfileSchema.parse({ ...upgraded, name: 'Archived' });
                    references.set(pointer, new ProfileReference(pointer, upgraded, this.definitions));
                    if (JSON.stringify(data) !== JSON.stringify(upgraded)) upgrades.push([key, upgraded]);
                } catch (error) {
                    if (!recover) throw error;
                    await this.store.remove(key);
                }
            }
            if (recover) upgrades.push(['profile_snapshot_sequence', sequence]);
            await this.journal.commit(upgrades);
            this.references = references;
            this.sequence = sequence;
        })();
    }

    /** @brief Clear the entire dedicated archive unit without interpreting old records. */
    reset(): Promise<void> {
        return this.write(async () => {
            await this.journal.discard();
            await clearStore(this.store);
            this.references.clear();
            this.sequence = 0;
            this.loaded = undefined;
        });
    }

    /** @brief Retrieve a version that has entered a session, including deleted or superseded catalog entries. */
    async get(pointer: number): Promise<ProfileVersion> {
        await this.load();
        const reference = this.references.get(pointer);
        if (!reference) throw new Error(`Unknown Profile snapshot: ${pointer}`);
        return reference;
    }

    /** @brief Restore a current catalog version without archiving it. */
    async restore(pointer: number, data: Pick<ProfileData, 'root' | 'brief'>): Promise<ProfileVersion> {
        await this.load();
        if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer > this.sequence) throw new Error('Invalid Profile reference');
        const archived = this.references.get(pointer);
        if (archived && JSON.stringify(archived.serialize()) !== JSON.stringify(data)) throw new Error('Conflicting Profile snapshot');
        return archived ?? new ProfileReference(pointer, structuredClone(data), this.definitions);
    }

    /** @brief Reserve a durable increasing pointer; unreferenced global intermediate versions are not archived. */
    create(snapshot: ProfileSnapshot): Promise<ProfileVersion> {
        const data = structuredClone({ root: snapshot.serialize(), brief: snapshot.brief });
        return this.write(async () => {
            await this.load();
            if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Profile snapshot sequence exhausted');
            const pointer = ++this.sequence;
            await this.journal.commit([['profile_snapshot_sequence', pointer]]);
            return new ProfileReference(pointer, data, this.definitions);
        });
    }

    /** @brief Keep existence checks, first archive writes and holder publication under one shared lock. */
    use<T>(reference: ProfileVersion, publish: (reference: ProfileVersion) => Promise<T>): Promise<T> {
        return this.write(async () => {
            await this.load();
            if (!Number.isSafeInteger(reference.pointer) || reference.pointer <= 0 || reference.pointer > this.sequence) throw new Error('Invalid Profile reference');
            let archived = this.references.get(reference.pointer);
            if (archived && JSON.stringify(archived.serialize()) !== JSON.stringify(reference.serialize())) throw new Error('Conflicting Profile snapshot');
            if (!archived) {
                await this.journal.commit([[`profile_snapshot_${reference.pointer}`, reference.serialize()]]);
                archived = reference;
                this.references.set(reference.pointer, reference);
            }
            return publish(archived);
        });
    }

    /** @brief Archive a version idempotently without publishing another holder. */
    archive(reference: ProfileVersion): Promise<ProfileVersion> { return this.use(reference, async value => value); }

    /** @brief Serialize numbering and archive publication without poisoning later work on failure. */
    private write<T>(operation: () => Promise<T>): Promise<T> {
        const work = this.pending.then(operation);
        this.pending = work.catch(() => {});
        return work;
    }

    /** @brief Complete interrupted writes before the independent backend is closed. */
    flush(): Promise<void> { return this.journal.flush(); }
}
