import type { ProfileCollection, ProfileSnapshot, ProfileVersion } from './profile.js';
import type { PlaneProfileEditor } from './plane/editor.js';
import type { Profiles } from './catalog/profile_tree.js';

/** @brief Basic saved-Profile event; specialized event descriptions may extend this interface. */
export interface ProfileSaveEvent {
    readonly name: string;
    /** @brief ISO 8601 UTC time recorded after successful persistence. */
    readonly time: string;
    readonly type: string;
}

/** @brief Observe a completed save without producing tool feedback. */
export type ProfileSaveEffect = (event: ProfileSaveEvent) => void | Promise<void>;

/** @brief Optional initialization and completed-save notification for one atomic edit. */
export interface ProfileEditOptions {
    /** @brief Initialize a missing catalog entry from this detached snapshot; omitted means it must exist. */
    readonly initial?: ProfileSnapshot;
    /** @brief Emit this save event after publication and after releasing the edit transaction. */
    readonly event?: string;
}

/** @brief Portable namespace service for shared named Profile management. */
export interface ToolsNamespace extends ProfileCollection {
    readonly editor: PlaneProfileEditor;
    /** @brief Load or explicitly recover Profile storage without initializing IntelliSense services. */
    initialize(recover?: boolean | 'reset'): Promise<void>;
    readonly revision: string;
    /** @brief Read catalog names and the default selection through the same service. */
    selection(): Promise<Profiles>;
    /** @brief Choose the default for future sessions without changing existing references. */
    setDefault(name: string): Promise<void>;
    /** @brief Declare configured aliases to be materialized before publishing or referencing trees. */
    setAliases(aliases: readonly { path: string; tool: string }[]): void;
    /** @brief Read an immutable current version; omitted name chooses the default. */
    reference(name?: string): Promise<ProfileVersion>;
    /** @brief Restore a previously archived session version, including deleted catalog entries. */
    restore(pointer: number): Promise<ProfileVersion>;
    /** @brief Archive once and publish a session holder while retaining the same version identity. */
    retain<T>(reference: ProfileVersion, publish: (reference: ProfileVersion) => Promise<T>): Promise<T>;
    /** @brief Atomically edit the latest snapshot and optionally initialize a missing entry or notify save observers. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot, options?: ProfileEditOptions): Promise<ProfileSnapshot>;
    /** @brief Register ordered, disposable events emitted only after save or apply has persisted successfully. */
    on(event: 'save', handler: ProfileSaveEffect): () => void;
}

/** @brief Declare the independent Profile service without importing namespace execution assembly. */
declare module '@deepseek-ai/cordis' {
    interface Context { toolsNamespace: ToolsNamespace }
}
