import type { ProfileData } from '../profile_tree.js';
import type { ProfileNamespace } from './namespace.js';

/** @brief An independent editable Profile handle backed by a catalog or conversation snapshot. */
export interface Profile {
    readonly name: string;
    readonly brief: string | undefined;
    readonly root: ProfileNamespace;
    /** @brief Set this Profile's purpose. */
    setBrief(value: string): this;
    /** @brief Export the complete recursive tree without retaining class instances. */
    serialize(): ProfileData;
    /** @brief Validate and atomically persist the complete tree. */
    save(): Promise<void>;
}
