import type { ProfileData } from '../profile_tree.js';
import type { ProfilePatch, ProfileWrite } from '../profile_write.js';
import type { ProfileNode } from './node.js';
import type { ProfileNamespace } from './namespace.js';

/** @brief A portable anonymous Profile tree snapshot, independent of its catalog name. */
export interface Profile extends ProfileNamespace {
    /** @brief Resolve an enabled node path within this snapshot without execution or catalog access. */
    resolve(path: string): ProfileNode | undefined;
    /** @brief Clone a Profile or hydrate stored data while retaining the concrete root and member implementations. */
    clone(value?: Pick<ProfileData, 'root' | 'brief'>): ProfileSnapshot;
    /** @brief Apply an explicit patch through this root and its child implementations. */
    apply(patch: ProfilePatch): this;
    /** @brief Compare a complete target with this Profile, then apply the resulting patch. */
    save(value: ProfileWrite): this;
    readonly brief: string | undefined;
    /** @brief Edit the Profile purpose within this snapshot only. */
    setBrief(value: string): this;
}

/** @brief Profile and ProfileSnapshot describe the same anonymous editing value. */
export type ProfileSnapshot = Profile;

/** @brief Construct a fresh typed Profile with its initial nodes; use clone to hydrate stored data. */
export type ProfileFactory = () => ProfileSnapshot;

/** @brief Named snapshot collection with atomic callback-based modification. */
export interface ProfileCollection {
    /** @brief Replaceable no-argument constructor used to declare initial Profile nodes and their concrete types. */
    createInitialProfile: ProfileFactory;
    /** @brief List catalog names without Profile data or selection metadata. */
    list(): Promise<string[]>;
    /** @brief Read an independent tree snapshot, or undefined when absent. */
    get(name: string): Promise<ProfileSnapshot | undefined>;
    /** @brief Create an initialized named Profile; duplicate names are rejected. */
    create(name: string): Promise<ProfileSnapshot>;
    /** @brief Read an existing Profile or atomically create an initialized one. */
    getOrCreate(name: string): Promise<ProfileSnapshot>;
    /** @brief Delete a named Profile, falling back when selected; the last Profile cannot be removed. */
    remove(name: string): Promise<void>;
    /** @brief Publish only the snapshot returned by the modifier after complete validation. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;
}
