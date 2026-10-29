import type { ProfileFactory, ProfileSnapshot } from '../registry/profile/profile.js';
import { RegistryConfiguration } from '../registry/configuration.js';
import { editedConfiguration } from '../registry/profile/configuration.js';
import type { ProfileSaveEffect, ToolsNamespace } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief Shared named Profile collection without command queries or execution state. */
export class NamespaceComponent implements ToolsNamespace {
    private profileWrites: Promise<unknown> = Promise.resolve();

    constructor(private ctx: Context, readonly registry: SemanticRegistry) {}

    /** @brief The collection's constructor creates the default typed tree and rehydrates stored Profiles. */
    get createInitialProfile(): ProfileFactory { return this.registry.definitions.createInitialProfile; }

    set createInitialProfile(factory: ProfileFactory) { this.registry.definitions.createInitialProfile = factory; }

    /** @brief Register disposable provider processing for agent save and apply. */
    effect(event: 'save', handler: ProfileSaveEffect): () => void { return this.registry.definitions.effect(event, handler); }

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
        return this.profileTransaction(() => this.createProfile(name));
    }

    /** @brief Serialize concurrent get-or-create operations under the collection transaction. */
    getOrCreate(name: string): Promise<ProfileSnapshot> {
        return this.profileTransaction(async () => await this.get(name) ?? this.createProfile(name));
    }

    /** @brief Remove a catalog entry in submission order using the registry's deletion rules. */
    remove(name: string): Promise<void> {
        return this.profileTransaction(async () => {
            await this.registry.manageProfile('delete', name, this.registry.revision);
            this.ctx.emit('system-prompt/change');
        });
    }

    /** @brief Publish only the callback result, preserving current data when the callback fails. */
    edit(name: string, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot> {
        return this.profileTransaction(async () => {
            const registry = this.registry;
            const current = registry.configuration(name);
            const revision = registry.revision;
            const input = (await registry.reference(name)).snapshot;
            const output = modifier(input);
            if (!output || typeof output.serialize !== 'function') throw new Error('Profile modifier must return a snapshot');
            const published = registry.definitions.profile({ brief: output.brief, root: output.serialize() });
            const value = { name, brief: published.brief, root: published.serialize() };
            const configuration = editedConfiguration(value, current, registry.definitions);
            await registry.saveProfile(name, configuration, { trusted: true, revision });
            this.ctx.emit('system-prompt/change');
            return this.registry.definitions.profile(value);
        });
    }

    /** @brief Create one initialized catalog entry in the registry's atomic name transaction. */
    private async createProfile(name: string): Promise<ProfileSnapshot> {
        const snapshot = this.createInitialProfile();
        const configuration = editedConfiguration({ name, root: snapshot.serialize() }, new RegistryConfiguration(), this.registry.definitions);
        await this.registry.saveProfile(name, configuration, { trusted: true, create: true });
        this.ctx.emit('system-prompt/change');
        return snapshot;
    }

    /** @brief Keep asynchronous catalog creation operations in submission order. */
    profileTransaction<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.profileWrites.then(operation);
        this.profileWrites = result.catch(() => {});
        return result;
    }

}
