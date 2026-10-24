import { createHash } from 'node:crypto';
import { SemanticRegistry, type RegistryState } from './registry.js';
import type { Store } from '../storage/store.js';

/** @brief Session-owned registries isolate working snapshots from the durable named catalog. */
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

    /** @brief Keep one durable working snapshot per live session instead of an append-only version history. */
    private async open(session: string): Promise<SemanticRegistry> {
        const key = `profile_session_${this.hash(session)}`;
        const state = this.catalog.snapshot();
        const initial: RegistryState = { version: 1, revision: 0, ...this.catalog.configuration(), profile: state.profile };
        const registry = new SemanticRegistry({
            load: async <T>() => (await this.store.load<T>(key)) ?? (structuredClone(initial) as T),
            save: async <T>(_key: string, value: T) => { await this.store.save(key, value); },
            remove: async () => { await this.store.remove(key); },
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

    /** @brief Delete the working snapshot after initialization settles and release the live handle. */
    async release(session: string): Promise<void> {
        const pending = this.sessions.get(session);
        if (!pending) return;
        try { await pending; }
        finally {
            await this.store.remove(`profile_session_${this.hash(session)}`);
            if (this.sessions.get(session) === pending) this.sessions.delete(session);
        }
    }

    /** @brief Release all working snapshots owned by the namespace component. */
    async dispose(): Promise<void> { await Promise.all([...this.sessions.keys()].map(session => this.release(session))); }

    /** @brief Hash session identities into safe storage keys. */
    private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}
