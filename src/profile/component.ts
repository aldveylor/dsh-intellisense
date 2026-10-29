import type { ProfileFactory, ProfileSnapshot, ProfileVersion } from './profile.js';
import { PlaneProfile } from './plane/profile.js';
import { toPlaneProfile } from './plane/to_plane_profile.js';
import type { ProfileEditOptions, ProfileSaveEffect, ToolsNamespace } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
import type { SemanticRegistry } from './catalog/registry.js';

/** @brief Shared named Profile collection without command queries or execution state. */
export class NamespaceComponent implements ToolsNamespace {
    constructor(private ctx: Context, readonly registry: SemanticRegistry) {}

    get revision(): string { return `${this.registry.revision}:${this.registry.definitions.revision}`; }

    /** @brief Read the shared default and catalog names. */
    async selection() { return this.registry.profileSelection(); }

    /** @brief Change the default in the shared edit transaction. */
    async setDefault(name: string): Promise<void> {
        await this.registry.profileTransaction(() => this.registry.manageProfile('select', name, this.registry.revision));
    }

    /** @brief Materialize configured aliases through the Profile backend. */
    setAliases(aliases: readonly { path: string; tool: string }[]): void { this.registry.setAliases(aliases); }

    /** @brief Read a current immutable version. */
    reference(name?: string): Promise<ProfileVersion> { return this.registry.reference(name); }

    /** @brief Restore an archived version without consulting the current catalog. */
    restore(pointer: number): Promise<ProfileVersion> { return this.registry.snapshots.get(pointer); }

    /** @brief Archive and publish a holder atomically through the Profile backend. */
    retain<T>(reference: ProfileVersion, publish: (reference: ProfileVersion) => Promise<T>): Promise<T> { return this.registry.snapshots.use(reference, publish); }

    /** @brief The collection's constructor creates the default typed tree and rehydrates stored Profiles. */
    get createInitialProfile(): ProfileFactory { return this.registry.definitions.createInitialProfile; }

    set createInitialProfile(factory: ProfileFactory) { this.registry.definitions.createInitialProfile = factory; }

    /** @brief Register disposable provider processing for agent save and apply. */
    on(event: 'save', handler: ProfileSaveEffect): () => void { return this.registry.definitions.on(event, handler); }

    /** @brief List only catalog names without copying Profile trees. */
    async list(): Promise<string[]> {
        return this.registry.profileSelection().profiles;
    }

    /** @brief Read an anonymous, independently editable snapshot without publishing changes. */
    async get(name: string): Promise<ProfileSnapshot | undefined> {
        const registry = this.registry;
        if (!registry.profileSelection().profiles.includes(name)) return undefined;
        return (await registry.reference(name)).snapshot;
    }

    /** @brief Create a Profile using the collection factory and return its independent anonymous snapshot. */
    create(name: string): Promise<ProfileSnapshot> {
        return this.registry.profileTransaction(() => this.createProfile(name));
    }

    /** @brief Serialize concurrent get-or-create operations under the collection transaction. */
    getOrCreate(name: string): Promise<ProfileSnapshot> {
        return this.registry.profileTransaction(async () => await this.get(name) ?? this.createProfile(name));
    }

    /** @brief Remove a catalog entry in submission order using the registry's deletion rules. */
    remove(name: string): Promise<void> {
        return this.registry.profileTransaction(async () => {
            await this.registry.manageProfile('delete', name, this.registry.revision);
            this.ctx.emit('system-prompt/change');
        });
    }

    /** @brief Publish only the callback result, preserving current data when the callback fails. */
    async edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot, options: ProfileEditOptions = {}): Promise<ProfileSnapshot> {
        const saved = await this.registry.profileTransaction(async () => {
            const registry = this.registry;
            const exists = registry.profileSelection().profiles.includes(name);
            const current = exists ? registry.configuration(name) : new PlaneProfile();
            const revision = registry.revision;
            const input = exists ? (await this.reference(name)).snapshot : options.initial?.clone() ?? (await this.reference(name)).snapshot;
            const output = modifier(input);
            if (!output || typeof output.serialize !== 'function') throw new Error('Profile modifier must return a snapshot');
            const published = registry.definitions.profile({ brief: output.brief, root: output.serialize() });
            const value = { name, brief: published.brief, root: published.serialize() };
            const configuration = toPlaneProfile(value, current, registry.definitions);
            await registry.saveProfile(name, configuration, { trusted: true, revision });
            this.ctx.emit('system-prompt/change');
            return { snapshot: registry.definitions.profile(value), time: new Date().toISOString() };
        });
        if (options.event !== undefined) await this.registry.definitions.processSave(Object.freeze({ name, time: saved.time, type: options.event }));
        return saved.snapshot;
    }

    /** @brief Create one initialized catalog entry in the registry's atomic name transaction. */
    private async createProfile(name: string): Promise<ProfileSnapshot> {
        const snapshot = this.createInitialProfile();
        const configuration = toPlaneProfile({ name, root: snapshot.serialize() }, new PlaneProfile(), this.registry.definitions);
        await this.registry.saveProfile(name, configuration, { trusted: true, create: true });
        this.ctx.emit('system-prompt/change');
        return snapshot;
    }
}
