import type { ProfileCollection } from './profile.js';

/** @brief Basic saved-Profile event; specialized event descriptions may extend this interface. */
export interface ProfileSaveEvent {
    readonly name: string;
    /** @brief ISO 8601 UTC time recorded after successful persistence. */
    readonly time: string;
    readonly type: string;
}

/** @brief Observe a completed save without producing tool feedback. */
export type ProfileSaveEffect = (event: ProfileSaveEvent) => void | Promise<void>;

/** @brief Portable namespace service for shared named Profile management. */
export interface ToolsNamespace extends ProfileCollection {
    /** @brief Register ordered, disposable events emitted only after save or apply has persisted successfully. */
    effect(event: 'save', handler: ProfileSaveEffect): () => void;
}
