import { createHash } from 'node:crypto';
import type { Store } from '../storage/store.js';
import { SemanticRegistry, type RegistryState } from './registry.js';

/** @brief Persist independent session registries initialized once from the global configuration. */
export class SessionRegistries {
    private sessions = new Map<string, Promise<SemanticRegistry>>();

    constructor(private global: SemanticRegistry, private store: Store) {}

    /** @brief Reuse a session snapshot, copying the current global configuration only on first allocation. */
    async get(sessionId: string): Promise<SemanticRegistry> {
        let pending = this.sessions.get(sessionId);
        if (!pending) {
            const prefix = `registry_session_${createHash('sha256').update(sessionId).digest('hex')}`;
            pending = (async () => {
                const scoped: Store = {
                    load: <T>(key: string) => this.store.load<T>(`${prefix}_${key}`),
                    save: <T>(key: string, value: T) => this.store.save(`${prefix}_${key}`, value),
                };
                if (!await scoped.load<RegistryState>('registry')) {
                    await scoped.save('registry', { ...this.global.snapshot(), revision: 0, usage: {} });
                }
                const registry = new SemanticRegistry(scoped);
                await registry.load();
                return registry;
            })();
            this.sessions.set(sessionId, pending);
            void pending.catch(() => { if (this.sessions.get(sessionId) === pending) this.sessions.delete(sessionId); });
        }
        const registry = await pending;
        registry.refresh(this.global.tools());
        return registry;
    }

    /** @brief Release the in-memory registry while preserving its durable configuration. */
    release(sessionId: string): void { this.sessions.delete(sessionId); }
}
