import { createHash } from 'node:crypto';
import { SemanticRegistry, type RegistryState } from './registry.js';
import type { Store } from '../storage/store.js';

/** @brief Session-owned smart references point to immutable, durable configuration versions. */
export class ProfileSessions {
    private sessions = new Map<string, Promise<SemanticRegistry>>();

    constructor(private catalog: SemanticRegistry, private store: Store) {}

    /** @brief Capture the selected catalog version once; subsequent writes detach only this holder. */
    forSession(session: string): Promise<SemanticRegistry> {
        let pending = this.sessions.get(session);
        if (!pending) {
            pending = this.open(session);
            this.sessions.set(session, pending);
            void pending.catch(() => { if (this.sessions.get(session) === pending) this.sessions.delete(session); });
        }
        return pending;
    }

    /** @brief Persist the immutable object before publishing the reference that owns it. */
    private async open(session: string): Promise<SemanticRegistry> {
        const referenceKey = `profile_reference_${this.hash(session)}`;
        const save = async (state: RegistryState): Promise<void> => {
            const version = this.hash(JSON.stringify(state));
            await this.store.save(`profile_version_${version}`, state);
            await this.store.save(referenceKey, { version });
        };
        let reference = await this.store.load<{ version: string }>(referenceKey);
        if (!reference) {
            const state = this.catalog.snapshot();
            await save({ version: 1, revision: 0, ...this.catalog.configuration(), profile: state.profile });
            reference = await this.store.load<{ version: string }>(referenceKey);
        }
        const state = await this.store.load<RegistryState>(`profile_version_${reference!.version}`);
        if (!state) throw new Error('Missing referenced profile version');
        let current = state;
        const registry = new SemanticRegistry({
            load: async <T>() => structuredClone(current) as T,
            save: async <T>(_key: string, value: T) => {
                await save(value as RegistryState);
                current = structuredClone(value as RegistryState);
            },
        });
        await registry.load();
        return registry;
    }

    /** @brief Load a visible catalog entry by detaching only this session's smart reference. */
    async load(session: string, profile: string): Promise<SemanticRegistry> {
        const registry = await this.forSession(session);
        await registry.replaceConfiguration(this.catalog.configuration(profile), profile);
        return registry;
    }

    /** @brief Publish the current working version under an explicit name, allowing replacement. */
    async commit(session: string, profile: string): Promise<SemanticRegistry> {
        const registry = await this.forSession(session);
        await this.catalog.saveProfile(profile, registry.configuration());
        await registry.replaceConfiguration(registry.configuration(), profile);
        return registry;
    }

    /** @brief Release the live handle; the durable reference remains available on resume. */
    release(session: string): void { this.sessions.delete(session); }

    /** @brief Content-addressed keys preserve old versions after catalog replacement or deletion. */
    private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}
