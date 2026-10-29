import { CommandStatistics } from '../namespace/statistics.js';
import { createHash } from 'node:crypto';
import { SemanticRegistry } from './registry.js';
import { RegistryConfiguration, RegistryState, type RegistryStateData } from './configuration.js';
import { profileTree } from './profile_tree.js';
import { editedConfiguration } from './profile/configuration.js';
import type { ProfileSnapshot } from './profile/profile.js';
import type { AgentSessionAddition } from '../integration/agent_session_addition.js';
import type { Store } from '../storage/store.js';

/** @brief Own session snapshots; registry projections adapt existing internal consumers only. */
export class ProfileSessions {
    private sessions = new Map<string, Promise<AgentSessionAddition>>();
    private projections = new WeakMap<AgentSessionAddition, Promise<SemanticRegistry>>();
    private sources = new WeakMap<AgentSessionAddition, string>();
    private selections = new WeakMap<AgentSessionAddition, string>();

    constructor(private catalog: SemanticRegistry, private store: Store, readonly statistics = new CommandStatistics(store)) {}

    /** @brief Read the session Profile snapshot and its bound call-statistics interface. */
    async addition(session: string, inherit?: () => Promise<SemanticRegistry>, profile?: string): Promise<AgentSessionAddition> {
        let pending = this.sessions.get(session);
        if (!pending) {
            pending = this.open(session, inherit, profile);
            this.sessions.set(session, pending);
            void pending.catch(() => { if (this.sessions.get(session) === pending) this.sessions.delete(session); });
        }
        return pending;
    }

    /** @brief Project the snapshot for internal configuration and tool-schema consumers. */
    async forSession(session: string, inherit?: () => Promise<SemanticRegistry>, profile?: string): Promise<SemanticRegistry> {
        const addition = await this.addition(session, inherit, profile);
        let pending = this.projections.get(addition);
        if (!pending) {
            pending = this.project(session, addition);
            this.projections.set(addition, pending);
            void pending.catch(() => { if (this.projections.get(addition) === pending) this.projections.delete(addition); });
        }
        const registry = await pending;
        const fingerprint = JSON.stringify({ root: addition.profile.serialize(), brief: addition.profile.brief });
        if (this.sources.get(addition) !== fingerprint) {
            const name = this.selections.get(addition)!;
            await registry.replaceConfiguration(editedConfiguration({ name, root: addition.profile.serialize(), brief: addition.profile.brief }, registry.configuration(), this.catalog.definitions), name);
        }
        return registry;
    }

    /** @brief Adapt snapshot persistence without adding registry state to the session addition. */
    private async project(session: string, addition: AgentSessionAddition): Promise<SemanticRegistry> {
        const registry = new SemanticRegistry({
            load: async <T>() => {
                const name = this.selections.get(addition)!;
                const configuration = editedConfiguration({ name, root: addition.profile.serialize(), brief: addition.profile.brief }, this.catalog.configuration(), this.catalog.definitions);
                return new RegistryState({ ...configuration.save(), profile: name, revision: 0, inactiveProfiles: {} }).save() as T;
            },
            save: async <T>(_key: string, value: T) => {
                const state = value as RegistryStateData;
                const name = state.profile!;
                const snapshot = this.catalog.definitions.profile(profileTree(name, new RegistryConfiguration(state), this.catalog.definitions).save());
                await this.store.save(this.key(session), { name, root: snapshot.serialize(), brief: snapshot.brief });
                addition.profile = snapshot;
                this.selections.set(addition, name);
                this.sources.set(addition, JSON.stringify({ root: snapshot.serialize(), brief: snapshot.brief }));
            },
            remove: async () => { await this.store.remove(this.key(session)); },
        }, 'session', this.catalog.definitions);
        await registry.load();
        this.sources.set(addition, JSON.stringify({ root: addition.profile.serialize(), brief: addition.profile.brief }));
        return registry;
    }

    /** @brief Capture persisted data, a parent working copy, or the selected catalog Profile. */
    private async open(session: string, inherit?: () => Promise<SemanticRegistry>, profile?: string): Promise<AgentSessionAddition> {
        const saved = await this.store.load<{ name: string; root: ReturnType<ProfileSnapshot['serialize']>; brief?: string }>(this.key(session));
        let name: string;
        let snapshot: ProfileSnapshot;
        if (saved) {
            name = saved.name;
            snapshot = this.catalog.definitions.profile(saved);
        } else {
            const source = profile === undefined && inherit ? await inherit() : this.catalog;
            name = profile ?? source.profileSelection().selected;
            snapshot = source.definitions.profile(profileTree(name, source.configuration(profile), source.definitions).save());
        }
        const addition = { profile: snapshot, statistics: { recordCall: (tool: string) => this.statistics.recordCall(session, tool) } };
        this.selections.set(addition, name);
        return addition;
    }

    /** @brief Replace the session snapshot from a named catalog Profile. */
    async load(session: string, profile: string): Promise<SemanticRegistry> {
        const registry = await this.forSession(session);
        await registry.replaceConfiguration(this.catalog.configuration(profile), profile);
        return registry;
    }

    /** @brief Release both the session snapshot and its internal projection. */
    async release(session: string): Promise<void> {
        const pending = this.sessions.get(session);
        if (!pending) return;
        try { await pending; }
        finally {
            await this.store.remove(this.key(session));
            if (this.sessions.get(session) === pending) this.sessions.delete(session);
        }
    }

    /** @brief Release all live session snapshots. */
    async dispose(): Promise<void> { await Promise.all([...this.sessions.keys()].map(session => this.release(session))); }

    /** @brief Hash session identities into storage keys. */
    private key(session: string): string { return `profile_session_${createHash('sha256').update(session).digest('hex')}`; }
}
