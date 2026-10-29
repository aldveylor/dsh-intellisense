import type { ProfileNamespace } from './namespace.js';

/** @brief A portable anonymous Profile tree snapshot, independent of its catalog name. */
export interface Profile extends ProfileNamespace {
    readonly brief: string | undefined;
    /** @brief Edit the Profile purpose within this snapshot only. */
    setBrief(value: string): this;
}

/** @brief Profile and ProfileSnapshot describe the same anonymous editing value. */
export type ProfileSnapshot = Profile;

/** @brief Named snapshot collection with atomic callback-based modification. */
export interface ProfileCollection {
    /** @brief Read an independent tree snapshot, or undefined when absent. */
    get(name: string): Promise<ProfileSnapshot | undefined>;
    /** @brief Create an empty named Profile; duplicate names are rejected. */
    create(name: string): Promise<ProfileSnapshot>;
    /** @brief Read an existing Profile or atomically create an empty one. */
    getOrCreate(name: string): Promise<ProfileSnapshot>;
    /** @brief Publish only the snapshot returned by the modifier after complete validation. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot>;
}
