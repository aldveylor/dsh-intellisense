import type { ProfileFactory, ProfileSnapshot } from '../registry/profile/profile.js';
import { RegistryConfiguration } from '../registry/configuration.js';
import { editedConfiguration } from '../registry/profile/configuration.js';
import { profileTree, type CommandBrief, type Profiles } from '../registry/profile_tree.js';
import type { ProfileSaveEffect, ToolAddition, ToolsNamespace } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
import { SemanticRegistry } from '../registry/registry.js';
import { manifest, type Aliases, CommandNode } from './namespace.js';
import type * as presentation from '../integration/presentation.js';
import type { z } from 'zod';
import { createSearchEngines } from '../search/search.js';
import { CommandStatistics } from './statistics.js';
import type { NamespaceImplementation } from './nodes/context.js';
import { MemoryStore } from '../storage/store.js';

/** @brief Shared Profile collection and command-name resolution without Agent execution state. */
export class NamespaceComponent implements ToolsNamespace {
    private profileWrites: Promise<unknown> = Promise.resolve();
    catalogRevision = 0;
    /** @brief Refresh the physical catalog supplied by the integration layer. */
    refresh: () => Promise<void> = async () => {};

    constructor(private ctx: Context, readonly registry: SemanticRegistry, readonly aliases: z.infer<typeof Aliases>, readonly searchEngines = createSearchEngines(), readonly statistics = new CommandStatistics(new MemoryStore())) {
        ctx.effect(() => async () => { await this.statistics.dispose(); });
        ctx.on('tools/change', () => { this.catalogRevision++; });
    }

    /** @brief The collection's constructor creates the default typed tree and rehydrates stored Profiles. */
    get createInitialProfile(): ProfileFactory { return this.registry.definitions.createInitialProfile; }

    set createInitialProfile(factory: ProfileFactory) { this.registry.definitions.createInitialProfile = factory; }

    /** @brief Register disposable provider processing for agent save and apply. */
    effect(event: 'save', handler: ProfileSaveEffect): () => void { return this.registry.definitions.effect(event, handler); }

    /** @brief Install a provider namespace class and invalidate its projected bindings. */
    setNamespaceImplementation(path: string, implementation: NamespaceImplementation): () => void {
        const dispose = this.registry.definitions.setNamespaceImplementation(path, implementation);
        this.catalogRevision++;
        this.ctx.emit('system-prompt/change');
        return () => { dispose(); this.catalogRevision++; this.ctx.emit('system-prompt/change'); };
    }

    /** @brief Register reversible physical-tool attributes through the shared definitions. */
    setToolAddition(tool: string, addition: ToolAddition): () => void {
        const dispose = this.registry.definitions.setToolAddition(tool, addition);
        this.catalogRevision++;
        this.ctx.emit('system-prompt/change');
        return () => { dispose(); this.catalogRevision++; this.ctx.emit('system-prompt/change'); };
    }

    /** @brief List only catalog names without copying Profile trees. */
    async list(): Promise<string[]> {
        return this.registry.profileSelection().profiles;
    }

    /** @brief Read an anonymous, independently editable snapshot without publishing changes. */
    async get(name: string): Promise<ProfileSnapshot | undefined> {
        const registry = this.registry;
        if (!registry.profileSelection().profiles.includes(name)) return undefined;
        return this.registry.definitions.profile(profileTree(name, registry.configuration(name), registry.definitions).save());
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
            const input = this.registry.definitions.profile(profileTree(name, current, registry.definitions).save());
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

    /** @brief Resolve an enabled command path to its physical name without invoking it. */
    async resolve(path: string, profile?: string): Promise<string | undefined> {
        await this.refresh();
        if (profile !== undefined && !this.registry.profileSelection().profiles.includes(profile)) return undefined;
        let registry = this.registry;
        if (profile !== undefined) {
            registry = new SemanticRegistry(new MemoryStore(), 'session', this.registry.definitions);
            await registry.replaceConfiguration(this.registry.configuration(profile), profile);
            registry.refresh(this.registry.tools());
        }
        const node = manifest(registry, this.aliases).resolve(path.replace(/^global\./, '').split('.'));
        return node instanceof CommandNode && !node.disabled ? node.tool : undefined;
    }

    /** @brief List catalog commands with mount paths including disabled paths, excluding plugin builtins. */
    async commandBriefs(registry = this.registry): Promise<CommandBrief[]> {
        await this.refresh();
        const paths = new Map<string, string[]>();
        const mounts = registry.snapshot().mappings;
        const mounted = new Set(mounts.map(mapping => mapping.id));
        for (const { id, path } of mounts) {
            if (!paths.has(id)) paths.set(id, []);
            if (!paths.get(id)!.includes(path)) paths.get(id)!.push(path);
        }
        for (const { tool, path } of this.aliases) {
            if (!mounted.has(tool)) continue;
            if (!paths.get(tool)!.includes(path)) paths.get(tool)!.push(path);
        }
        const callsByTool = await this.statistics.counterSnapshot('callsByTool');
        return this.registry.tools().filter(tool => !this.registry.definitions.addition(tool.id).hidden && !this.registry.definitions.addition(tool.id).fixed).map(tool => ({
            name: tool.id, brief: tool.description, paths: paths.get(tool.id) ?? [], totalCalls: Object.hasOwn(callsByTool, tool.id) ? callsByTool[tool.id]! : 0,
        }));
    }

    /** @brief Read catalog names separately from the conversation's selected Profile. */
    async profileNames(registry = this.registry): Promise<Profiles> {
        return { profiles: this.registry.profileSelection().profiles, selected: registry.profileSelection().selected };
    }

    /** @brief Compute only enabled Profile metadata before guest execution. */
    async values(registry = this.registry, mode: presentation.PresentationMode = 'ptc'): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>> {
        const values: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
        const root = manifest(registry, this.aliases ?? [], mode);
        for (const entry of root.commands()) {
            if (entry.disabled) continue;
            const producer = registry.definitions.addition(entry.tool).value;
            if (producer) values[entry.path] = await producer.read(this, registry);
        }
        return values;
    }

}
