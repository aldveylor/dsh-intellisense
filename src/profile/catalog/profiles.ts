import { Statistics } from '../../statistics/statistics.js';
import { CommandStatistics } from '../../statistics/command_statistics.js';
import { createHash } from 'node:crypto';
import type { ProfileSessionCollection } from '../session.js';
import type { ToolsNamespace } from '../service.js';
import type { ProfileVersion } from '../profile.js';
import type { AgentSessionAddition } from '../../integration/agent_session_addition.js';
import type { Session } from '@deepseek-ai/dsh-session';
import type { Store } from '../../storage/store.js';

/** @brief Persist session references without copying Profiles or constructing session registries. */
export class ProfileSessions implements ProfileSessionCollection {
    private replacements = new WeakMap<AgentSessionAddition, (name: string, reference: ProfileVersion) => void>();
    private opening = new WeakMap<Session, Promise<AgentSessionAddition>>();
    private writes = new WeakMap<AgentSessionAddition, Promise<unknown>>();
    readonly inspectStatistics: Statistics;

    constructor(private catalog: ToolsNamespace, private store: Store, readonly statistics = new CommandStatistics(store)) { this.inspectStatistics = new Statistics(store, 'inspect_statistics'); }

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
        const name = saved?.name ?? profile ?? parent?.name ?? (await this.catalog.selection()).selected;
        let selected = name;
        let reference = saved ? await this.catalog.restore(saved.pointer)
            : parent?.profile ?? await this.catalog.reference(name);
        const addition: AgentSessionAddition = {
            get name() { return selected; },
            get profile() { return reference; },
            statistics: this.statistics.calls.scope(session.id),
            save: () => this.write(addition, () => this.store.save(this.key(session.id), { name: selected, pointer: reference.pointer })),
        };
        this.replacements.set(addition, (name, value) => { selected = name; reference = value; });
        if (!saved) await this.catalog.retain(reference, async archived => {
            await this.store.save(this.key(session.id), { name, pointer: archived.pointer });
            reference = archived;
        });
        session.intellisense = addition;
        return addition;
    }

    /** @brief Switch this holder to the catalog's latest pointer while retaining every older version. */
    async load(session: Session, name: string): Promise<AgentSessionAddition> {
        const addition = await this.addition(session);
        return this.write(addition, async () => {
            const reference = await this.catalog.reference(name);
            return this.catalog.retain(reference, async archived => {
                await this.store.save(this.key(session.id), { name, pointer: archived.pointer });
                this.replacements.get(addition)!(name, archived);
                return addition;
            });
        });
    }

    /** @brief Hash session identities into storage keys. */
    private key(session: string): string { return `profile_session_${createHash('sha256').update(session).digest('hex')}`; }
}
