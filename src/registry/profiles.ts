import { createHash } from 'node:crypto';
import { SemanticRegistry, RegistryState } from './registry.js';
import type { Store } from '../storage/store.js';

/** @brief Session-owned registries isolate working snapshots from the durable named catalog. */
export class ProfileSessions {
    private sessions = new Map<string, Promise<SemanticRegistry>>();

    constructor(private catalog: SemanticRegistry, private store: Store) {}

    /** @brief Capture an optional parent working copy or the catalog default once per session. */
    forSession(session: string, inherit?: () => Promise<SemanticRegistry>): Promise<SemanticRegistry> {
        let pending = this.sessions.get(session);
        if (!pending) {
            pending = this.open(session, inherit);
            this.sessions.set(session, pending);
            void pending.catch(() => { if (this.sessions.get(session) === pending) this.sessions.delete(session); });
        }
        return pending;
    }

    /** @brief Keep one durable working snapshot per live session instead of an append-only version history. */
    private async open(session: string, inherit?: () => Promise<SemanticRegistry>): Promise<SemanticRegistry> {
        const key = `profile_session_${this.hash(session)}`;
        const registry = new SemanticRegistry({
            load: async <T>() => {
                const saved = await this.store.load<T>(key);
                if (saved !== undefined) return saved;
                const source = inherit ? await inherit() : this.catalog;
                const initial = new RegistryState({ ...source.configuration().save(), profile: source.profileSelection().selected });
                return initial.save() as T;
            },
            save: async <T>(_key: string, value: T) => { await this.store.save(key, value); },
            remove: async () => { await this.store.remove(key); },
        }, 'session');
        await registry.load();
        return registry;
    }

    /** @brief Replace this session's working configuration with an independent catalog snapshot. */
    async load(session: string, profile: string): Promise<SemanticRegistry> {
        const registry = await this.forSession(session);
        await registry.replaceConfiguration(this.catalog.configuration(profile), profile);
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
