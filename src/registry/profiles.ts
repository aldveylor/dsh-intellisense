import { Statistics } from '../statistics/statistics.js';
import { CommandStatistics } from '../statistics/command_statistics.js';
import { createHash } from 'node:crypto';
import type { SemanticRegistry } from './registry.js';
import type { ProfileSnapshot } from './profile/profile.js';
import type { AgentSessionAddition } from '../integration/agent_session_addition.js';
import type { Session } from '@deepseek-ai/dsh-session';
import type { Store } from '../storage/store.js';

/** @brief Persist session references without copying Profiles or constructing session registries. */
export class ProfileSessions {
    private opening = new WeakMap<Session, Promise<AgentSessionAddition>>();
    private writes = new WeakMap<AgentSessionAddition, Promise<unknown>>();
    readonly inspectStatistics: Statistics;

    constructor(private catalog: SemanticRegistry, private store: Store, readonly statistics = new CommandStatistics(store)) { this.inspectStatistics = new Statistics(store, 'inspect_statistics'); }

    /** @brief Restore an old reference or inherit the parent's exact immutable version. */
    async addition(session: Session, inherit?: () => Promise<AgentSessionAddition | undefined>, profile?: string): Promise<AgentSessionAddition> {
        if (session.intellisense) return session.intellisense;
        let pending = this.opening.get(session);
        if (!pending) {
            pending = this.open(session, inherit, profile);
            this.opening.set(session, pending);
            void pending.finally(() => { this.opening.delete(session); }).catch(() => {});
        }
        return pending;
    }

    /** @brief Read the same session-owned reference without adapting it into another state model. */
    forSession(session: Session, inherit?: () => Promise<AgentSessionAddition | undefined>, profile?: string): Promise<AgentSessionAddition> { return this.addition(session, inherit, profile); }

    /** @brief Serialize reference changes and publish only after their session record is durable. */
    private write<T>(addition: AgentSessionAddition, operation: () => Promise<T>): Promise<T> {
        const work = (this.writes.get(addition) ?? Promise.resolve()).then(operation);
        this.writes.set(addition, work.catch(() => {}));
        return work;
    }

    /** @brief Store only selection metadata and the numeric snapshot pointer. */
    private async open(session: Session, inherit?: () => Promise<AgentSessionAddition | undefined>, profile?: string): Promise<AgentSessionAddition> {
        const saved = await this.store.load<{ name: string; pointer: number }>(this.key(session.id));
        const parent = !saved && profile === undefined ? await inherit?.() : undefined;
        const name = saved?.name ?? profile ?? parent?.name ?? this.catalog.profileSelection().selected;
        const reference = saved ? await this.catalog.snapshots.get(saved.pointer) : parent?.profile ?? await this.catalog.reference(name);
        const addition: AgentSessionAddition = {
            name, profile: reference,
            statistics: this.statistics.calls.scope(session.id),
            save: (snapshot?: ProfileSnapshot) => {
                const value = (snapshot ?? addition.profile.snapshot).clone();
                return this.write(addition, async () => {
                    const reference = await this.catalog.snapshots.save(value);
                    await this.store.save(this.key(session.id), { name: addition.name, pointer: reference.pointer });
                    addition.profile = reference;
                });
            },
        };
        if (!saved) await this.store.save(this.key(session.id), { name, pointer: reference.pointer });
        session.intellisense = addition;
        return addition;
    }

    /** @brief Switch this holder to the catalog's latest pointer while retaining every older version. */
    async load(session: Session, name: string): Promise<AgentSessionAddition> {
        const addition = await this.addition(session);
        return this.write(addition, async () => {
            const reference = await this.catalog.reference(name);
            await this.store.save(this.key(session.id), { name, pointer: reference.pointer });
            addition.name = name;
            addition.profile = reference;
            return addition;
        });
    }

    /** @brief Hash session identities into storage keys. */
    private key(session: string): string { return `profile_session_${createHash('sha256').update(session).digest('hex')}`; }
}
