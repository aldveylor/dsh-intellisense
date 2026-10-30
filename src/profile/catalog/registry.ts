import { EditableNamespace, type ProfileNamespace } from '../namespace.js';
import { EditableFunction, type ProfileFunction } from '../function.js';
import { profileMembers, protectedToolNames } from '../namespace/namespace.js';
import { toPlaneProfile } from '../plane/to_plane_profile.js';
import { SnapshotStore } from '../snapshot_store.js';
import { profileTree, ProfileSchema } from './profile_tree.js';
import { validateProfileEdit } from '../validate_edit.js';
import { NamespaceDefinitions } from '../namespace/definitions.js';
import { ToolAdditions, type ToolAddition } from '../../integration/tool_additions/tool_additions.js';
import { settingsAt } from '../node_settings.js';
import { ProfileNodeSettingsSchema } from './node_settings_schema.js';
import { ProfileNotFoundError } from '../../error.js';
import type { ProfileSnapshot, ProfileVersion } from '../profile.js';
import { toolName, validatePath } from './path.js';
export { validatePath } from './path.js';
import { storageVersion } from '../../storage/version.js';
import { upgradeProfileCatalog } from '../../storage/compatibility/configuration_upgrade.js';
import { clearStore, type Store } from '../../storage/store.js';
import { recoverProfile } from './recover_profile.js';
import { PlaneProfile, PlaneProfileState, type PlaneProfileData, type PlaneProfileStateData } from '../plane/profile.js';

/** @brief Current named Profiles plus numeric versions; session archives are stored independently. */
export interface ProfileCatalogData {
    version: number;
    revision: number;
    profile: string;
    profiles: Record<string, { pointer: number; root: import('./profile_node.js').NamespaceTreeNode; brief?: string }>;
    editor?: Record<string, { order: string[]; unmountedVisible: CommandVisibility; toolComments: Record<string, string>; pinned: string[] }>;
}

/** @brief Stable physical identity and the enforced native JSON contracts. */
export interface PhysicalTool {
    id: string;
    addition?: Pick<ToolAddition, 'hidden' | 'ptcDescription'>;
    provided?: boolean;
    source?: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
    /** @brief TypeScript return declaration supplied by the management API for display. */
    outputDeclaration?: string;
}

import type { CommandVisibility, Mapping, Namespace } from '../plane/profile.js';
export type { PinLevel, CommandVisibility, Mapping, Namespace } from '../plane/profile.js';

export { PlaneProfile, PlaneProfileState } from '../plane/profile.js';
export type { PlaneProfileData, PlaneProfileStateData } from '../plane/profile.js';

/** @brief Global configuration schema version, independent of the package version. */
const configurationVersion = storageVersion;

/** @brief Transactional semantic registry; unconfigured identities use encoded tools paths. */
export class SemanticRegistry {
    private profileWrites: Promise<unknown> = Promise.resolve();
    private physical = new Map<string, PhysicalTool>();
    private physicalFingerprint = '';
    private physicalRevision = 0;
    private protectedCache?: { revision: number; root: ProfileSnapshot; tools: ReadonlySet<string> };
    private get protectedDefinition(): NonNullable<SemanticRegistry['protectedCache']> {
        if (this.protectedCache?.revision !== this.definitions.revision) {
            const root = this.definitions.createInitialProfile();
            this.protectedCache = { revision: this.definitions.revision, root, tools: protectedToolNames(root) };
        }
        return this.protectedCache;
    }
    private get protectedNodes(): ProfileSnapshot { return this.protectedDefinition.root; }
    private state = new PlaneProfileState({ inactiveProfiles: {} });
    private writeChain: Promise<unknown> = Promise.resolve();

    private aliases: readonly { path: string; tool: string }[] = [];
    private aliasChecks = new WeakSet<ProfileVersion>();
    readonly snapshots: SnapshotStore;
    readonly toolAdditions = new ToolAdditions();
    private references: Record<string, ProfileVersion> = Object.create(null);

    constructor(private store: Store, _scope: 'global' | 'session' = 'global', readonly definitions = new NamespaceDefinitions(), snapshotStore: Store = store) { this.snapshots = new SnapshotStore(snapshotStore, definitions); }

    /** @brief Serialize collection edits and tool read-modify-write operations against the shared Profile catalog. */
    profileTransaction<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.profileWrites.then(operation);
        this.profileWrites = result.catch(() => {});
        return result;
    }

    /** @brief Read the immutable version currently published under a catalog name. */
    /** @brief Import configured aliases into global Profiles before they become session snapshots. */
    setAliases(aliases: readonly { path: string; tool: string }[]): void { this.aliases = structuredClone(aliases); this.aliasChecks = new WeakSet(); }

    private withAliases(snapshot: ProfileSnapshot): ProfileSnapshot {
        const mounted = new Set([...profileMembers(snapshot)].filter(({ node }) => node.type === 'function').map(({ node }) => (node as ProfileFunction).tool));
        for (const alias of this.aliases) {
            if (!mounted.has(alias.tool)) continue;
            const parts = alias.path.split('.');
            let parent: ProfileNamespace = snapshot;
            for (const name of parts.slice(0, -1)) {
                const child = parent.getOrCreate(name, () => new EditableNamespace());
                if (child.type !== 'namespace') throw new Error(`Conflicting tool alias: ${alias.path}`);
                parent = child as ProfileNamespace;
            }
            const name = parts.at(-1)!;
            const previous = parent.get(name);
            if (previous) {
                if (previous.type !== 'function' || (previous as ProfileFunction).tool !== alias.tool) throw new Error(`Conflicting tool alias: ${alias.path}`);
            } else parent.create(name, () => new EditableFunction()).setTool(alias.tool);
        }
        return snapshot;
    }

    async reference(name = this.state.profile): Promise<ProfileVersion> {
        if (!this.references[name]) {
            this.configuration(name);
            await this.transaction(async () => { if (!this.references[name]) await this.persist(this.state, [name]); });
        }
        const reference = this.references[name]!;
        if (this.aliases.length && !this.aliasChecks.has(reference)) {
            const snapshot = reference.snapshot;
            const before = JSON.stringify(snapshot.serialize());
            this.withAliases(snapshot);
            if (JSON.stringify(snapshot.serialize()) !== before) await this.transaction(() => this.persist(this.state, [name]));
            this.aliasChecks.add(this.references[name]!);
        }
        return this.references[name]!;
    }

    /** @brief Store current global Profiles and pointers; archive data is written only when a session enters. */
    private async persist(state: PlaneProfileState, updated: readonly string[] = []): Promise<void> {
        const configurations = { ...state.inactiveProfiles, [state.profile]: state };
        const references: Record<string, ProfileVersion> = Object.create(null);
        for (const [name, configuration] of Object.entries(configurations)) {
            if (this.references[name] && !updated.includes(name)) references[name] = this.references[name]!;
            else {
                const snapshot = this.withAliases(this.definitions.profile(profileTree(name, configuration, this.definitions).save()));
                references[name] = await this.snapshots.create(snapshot);
            }
        }
        const canonicalConfigurations: [PlaneProfile, PlaneProfile][] = [];
        for (const [name, configuration] of Object.entries(configurations)) {
            if (this.references[name] && !updated.includes(name)) continue;
            const snapshot = references[name]!.snapshot;
            const canonical = toPlaneProfile({ name, root: snapshot.serialize(), brief: snapshot.brief }, configuration, this.definitions);
            canonical.order = [...configuration.order];
            canonical.unmountedVisible = structuredClone(configuration.unmountedVisible);
            canonical.toolComments = structuredClone(configuration.toolComments);
            for (const mapping of canonical.mappings) mapping.pinned = configuration.mappings.some(previous => previous.path === mapping.path && previous.pinned);
            canonicalConfigurations.push([configuration, canonical]);
        }
        await this.store.save('registry', { version: storageVersion, revision: state.revision, profile: state.profile,
            profiles: Object.fromEntries(Object.entries(references).map(([name, reference]) => [name, { pointer: reference.pointer, ...reference.serialize() }])),
            editor: Object.fromEntries(Object.entries(configurations).map(([name, configuration]) => [name, { order: configuration.order, unmountedVisible: configuration.unmountedVisible, toolComments: configuration.toolComments, pinned: configuration.mappings.filter(mapping => mapping.pinned).map(mapping => mapping.path) }])) } satisfies ProfileCatalogData);
        this.references = references;
        for (const [configuration, canonical] of canonicalConfigurations) Object.assign(configuration, canonical);
    }

    /** @brief Serialize loading and recovery with ordinary configuration writes. */
    load(recover: boolean | 'reset' = false): Promise<void> {
        return this.transaction(async () => {
            if (recover === 'reset') {
                await clearStore(this.store);
                await this.snapshots.reset();
                this.references = Object.create(null);
                const state = new PlaneProfileState({ inactiveProfiles: {} });
                await this.persist(state);
                this.state = state;
            } else await this.loadSnapshot(recover);
        });
    }

    /** @brief Restore current referenced Profiles; explicit recovery discards invalid entries without rewriting archives. */
    private async loadSnapshot(recover: boolean): Promise<void> {
        await this.snapshots.load(recover);
        let saved = await this.store.load<ProfileCatalogData>('registry');
        if (saved === undefined) return;
        const original = saved;
        let upgrading = false;
        try {
            saved = await upgradeProfileCatalog(saved, async (name, data) => {
                this.validateProfileName(name);
                const configuration = new PlaneProfile(data);
                ProfileNodeSettingsSchema.parse(configuration.nodeSettings);
                if (configuration.providedRoot) ProfileSchema.parse({ name, root: configuration.providedRoot });
                this.validateMappings(configuration.mappings);
                this.validateNamespaces(configuration.namespaces, configuration.mappings);
                this.validateVisibility(configuration.unmountedVisible);
                this.validateVisibility(configuration.builtinVisible);
                this.validateDisabled(configuration.builtinDisabled, configuration.providedRoot);
                this.validateNamespaceVisible(configuration.namespaceVisible);
                this.validateComments(configuration.toolComments);
                if (configuration.order.some(path => typeof path !== 'string')) throw new Error('Invalid Profile editor settings');
                const snapshot = this.definitions.profile(profileTree(name, configuration, this.definitions).save());
                const reference = await this.snapshots.create(snapshot);
                return { profile: { pointer: reference.pointer, ...reference.serialize() }, editor: {
                    order: configuration.order, unmountedVisible: configuration.unmountedVisible, toolComments: configuration.toolComments,
                    pinned: configuration.mappings.filter(mapping => mapping.pinned).map(mapping => mapping.path),
                } };
            });
            upgrading = JSON.stringify(saved) !== JSON.stringify(original);
        } catch (error) {
            if (!recover) throw new Error('Invalid Profile reference catalog', { cause: error });
        }
        const configurations: Record<string, PlaneProfile> = Object.create(null);
        const references: Record<string, ProfileVersion> = Object.create(null);
        const valid = saved && saved.version === configurationVersion && Number.isSafeInteger(saved.revision)
            && saved.revision >= 0 && saved.profiles && typeof saved.profiles === 'object' && !Array.isArray(saved.profiles);
        if (!valid && !recover) throw new Error('Invalid Profile reference catalog');
        if (valid) {
            for (const [name, value] of Object.entries(saved.profiles)) {
                try {
                    this.validateProfileName(name);
                    const data = recover ? recoverProfile(value, this.definitions.createInitialProfile()) : { root: value.root, brief: value.brief };
                    ProfileSchema.parse({ name, ...data });
                    const changed = JSON.stringify(data) !== JSON.stringify({ root: value.root, brief: value.brief });
                    let reference: ProfileVersion;
                    try { reference = changed ? await this.snapshots.create(this.definitions.profile(data)) : await this.snapshots.restore(value.pointer, data); }
                    catch (error) {
                        if (!recover) throw error;
                        reference = await this.snapshots.create(this.definitions.profile(data));
                    }
                    const snapshot = reference.snapshot;
                    const configuration = toPlaneProfile({ name, root: snapshot.serialize(), brief: snapshot.brief }, new PlaneProfile(), this.definitions);
                    const editor = saved.editor?.[name];
                    if (editor) {
                        try {
                            this.validateVisibility(editor.unmountedVisible);
                            this.validateComments(editor.toolComments);
                            if (!Array.isArray(editor.order) || editor.order.some(path => typeof path !== 'string') || !Array.isArray(editor.pinned)) throw new Error('Invalid Profile editor settings');
                            configuration.unmountedVisible = structuredClone(editor.unmountedVisible);
                            configuration.toolComments = structuredClone(editor.toolComments);
                            configuration.order = [...editor.order];
                            for (const mapping of configuration.mappings) mapping.pinned = editor.pinned.includes(mapping.path);
                        } catch (error) { if (!recover) throw error; }
                    }
                    references[name] = reference;
                    configurations[name] = configuration;
                } catch (error) { if (!recover) throw error; }
            }
        }
        let name = valid && Object.hasOwn(configurations, saved.profile) ? saved.profile : Object.keys(configurations)[0];
        if (!name && !recover) throw new Error('Invalid Profile reference catalog');
        name ??= 'Default';
        const state = new PlaneProfileState({ ...configurations[name], version: storageVersion, revision: valid ? saved.revision : 0, profile: name,
            inactiveProfiles: Object.fromEntries(Object.entries(configurations).filter(([key]) => key !== name)) });
        const previous = this.references;
        this.references = references;
        try {
            if (recover) await this.persist(state);
            else if (upgrading) await this.store.save('registry', saved);
        }
        catch (error) { this.references = previous; throw error; }
        this.state = state;
    }

    refresh(tools: PhysicalTool[]): void {
        if (new Set(tools.map(t => t.id)).size !== tools.length) throw new Error('Duplicate physical tool identity');
        const fingerprint = JSON.stringify(tools);
        if (fingerprint === this.physicalFingerprint) return;
        const next = new Map(tools.map(t => [t.id, structuredClone(t)]));
        this.physicalFingerprint = fingerprint;
        this.physicalRevision++;
        // Identifier escaping preserves physical names without merging distinct identities.
        this.physical = next;
    }

    /** @brief Read the configuration revision without copying Profile data. */
    get revision(): number { return this.state.revision; }

    /** @brief Identify configuration and physical-contract changes without copying either snapshot. */
    get generation(): string { return `${this.state.revision}:${this.physicalRevision}:${this.definitions.revision}:${this.toolAdditions.revision}`; }

    /** @brief Read Profile names and selection without cloning configuration data. */
    profileSelection(): { profiles: string[]; selected: string } {
        const selected = this.state.profile ?? 'Default';
        return { selected, profiles: [selected, ...Object.keys(this.state.inactiveProfiles ?? {})].sort((a, b) => a.localeCompare(b)) };
    }

    snapshot(): PlaneProfileState {
        const { inactiveProfiles: _inactiveProfiles, ...current } = this.state;
        const { selected: profile, profiles } = this.profileSelection();
        return new PlaneProfileState({ ...current, profile, profiles });
    }

    /** @brief Read catalog descriptions without copying namespace trees. */
    profileBriefs(): Record<string, string> {
        const configurations = { ...this.state.inactiveProfiles, [this.state.profile]: this.state };
        return Object.fromEntries(Object.entries(configurations).flatMap(([name, configuration]) =>
            configuration.brief === undefined ? [] : [[name, configuration.brief]]));
    }

    /** @brief Extract only the configurable fields when archiving an active profile. */
    configuration(name = this.state.profile ?? 'Default'): PlaneProfile {
        this.validateProfileName(name);
        if (name !== (this.state.profile ?? 'Default')) {
            const configuration = Object.hasOwn(this.state.inactiveProfiles ?? {}, name) ? this.state.inactiveProfiles![name] : undefined;
            if (!configuration) throw new ProfileNotFoundError(name);
            return new PlaneProfile(configuration);
        }
        return new PlaneProfile(this.state);
    }

    /** @brief Replace one reference's working configuration without modifying other holders. */
    async replaceConfiguration(configuration: PlaneProfileData, profile: string): Promise<void> {
        const detached = new PlaneProfile(configuration);
        await this.transaction(async () => {
            this.validateProfileName(profile);
            ProfileNodeSettingsSchema.parse(detached.nodeSettings);
            if (detached.providedRoot) ProfileSchema.parse({ name: 'Validated', root: detached.providedRoot });
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateDisabled(detached.builtinDisabled, detached.providedRoot);
            this.validateNamespaceVisible(detached.namespaceVisible);
            this.validateComments(detached.toolComments ?? {});
            const next: PlaneProfileStateData = { ...this.state, ...detached, toolComments: detached.toolComments ?? {}, profile, revision: this.state.revision + 1 };
            const state = new PlaneProfileState(next);
            await this.persist(state, [profile]);
            this.state = state;
        });
    }

    /** @brief Publish a new named version; existing session references retain their own snapshots. */
    async saveProfile(name: string, configuration: PlaneProfileData, options: { trusted?: boolean; create?: boolean; revision?: number } = {}): Promise<void> {
        const detached = new PlaneProfile(configuration);
        await this.transaction(async () => {
            this.validateProfileName(name);
            if (options.revision !== undefined && options.revision !== this.revision) throw new Error('registry_revision_conflict');
            const exists = this.profileSelection().profiles.includes(name);
            if (options.create && exists) throw new Error('profile_name_exists');
            if (!options.trusted) {
                const original = exists ? this.configuration(name) : new PlaneProfile();
                this.validateFixedMappings(detached.mappings, original.mappings);
                validateProfileEdit(profileTree(name, original, this.definitions).root, profileTree(name, detached, this.definitions).root, this.definitions);
            }
            ProfileNodeSettingsSchema.parse(detached.nodeSettings);
            if (detached.providedRoot) ProfileSchema.parse({ name: 'Validated', root: detached.providedRoot });
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateDisabled(detached.builtinDisabled, detached.providedRoot);
            this.validateNamespaceVisible(detached.namespaceVisible);
            this.validateComments(detached.toolComments ?? {});
            const next: PlaneProfileStateData = { ...this.state, revision: this.state.revision + 1 };
            if (name === (this.state.profile ?? 'Default')) Object.assign(next, detached, { toolComments: detached.toolComments ?? {} });
            else next.inactiveProfiles = { ...this.state.inactiveProfiles, [name]: detached };
            const state = new PlaneProfileState(next);
            await this.persist(state, [name]);
            this.state = state;
        });
    }

    /** @brief Tool-level comments also apply to tools that have no mounted path. */
    private validateComments(comments: Record<string, string>): void {
        if (!comments || typeof comments !== 'object' || Array.isArray(comments) || Object.values(comments).some(value => typeof value !== 'string')) throw new Error('Invalid tool comments');
    }

    /** @brief Keep names usable as both dictionary keys and menu labels. */
    private validateProfileName(name: string): void {
        if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('invalid_profile_name');
    }

    /** @brief Atomically manage named configurations under the same global revision as ordinary saves. */
    async manageProfile(action: 'create' | 'select' | 'rename' | 'delete', name: string, revision: number, newName?: string, activate = true): Promise<void> {
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('registry_revision_conflict');
            this.validateProfileName(name);
            const active = this.state.profile ?? 'Default';
            const archive = this.state.save().inactiveProfiles ?? {};
            const exists = (name: string): boolean => name === active || Object.hasOwn(archive, name);
            let next: PlaneProfileStateData = { ...this.state, revision: revision + 1, inactiveProfiles: archive };
            if (action === 'create') {
                if (exists(name)) throw new Error('profile_name_exists');
                const empty = new PlaneProfile();
                if (activate) {
                    archive[active] = this.configuration();
                    next = { ...next, ...empty, profile: name };
                } else archive[name] = empty;
            } else {
                if (!exists(name)) throw new ProfileNotFoundError(name);
                if (action === 'rename') {
                    this.validateProfileName(newName!);
                    if (newName === name) return;
                    if (exists(newName!)) throw new Error('profile_name_exists');
                    if (name === active) next.profile = newName!;
                    else { archive[newName!] = archive[name]!; delete archive[name]; }
                } else if (action === 'select') {
                    if (name === active) return;
                    const configuration = archive[name]!;
                    delete archive[name]; archive[active] = this.configuration();
                    next = { ...next, ...configuration, brief: configuration.brief, builtinDisabled: configuration.builtinDisabled ?? [], toolComments: configuration.toolComments ?? {}, namespaceVisible: configuration.namespaceVisible ?? {}, profile: name };
                } else if (action === 'delete') {
                    if (!Object.keys(archive).length) throw new Error('profile_required');
                    if (name === active) {
                        const fallback = Object.keys(archive)[0]!;
                        next = { ...next, ...archive[fallback]!, brief: archive[fallback]!.brief, builtinDisabled: archive[fallback]!.builtinDisabled ?? [], toolComments: archive[fallback]!.toolComments ?? {}, namespaceVisible: archive[fallback]!.namespaceVisible ?? {}, profile: fallback }; delete archive[fallback];
                    } else delete archive[name];
                } else throw new Error('Invalid profile action');
            }
            const state = new PlaneProfileState(next);
            const previousReferences = this.references;
            if (action === 'rename') this.references = { ...this.references, [newName!]: this.references[name]! };
            try { await this.persist(state); } catch (error) { this.references = previousReferences; throw error; }
            this.state = state;
        });
    }

    /** @brief Resolve explicit command and inherited namespace disablement without dropping editor state. */
    disabled(path: string): boolean {
        const node = this.protectedNodes.resolve(path);
        if (node && !node.permissions.disableable) return false;
        return [...(this.state.builtinDisabled ?? []), ...(this.state.namespaces ?? []).filter(node => node.disabled).map(node => node.path)]
            .some(prefix => path === prefix || path.startsWith(prefix + '.'))
            || this.state.mappings.some(mapping => mapping.disabled && mapping.path === path);
    }

    /** @brief Validate disabled builtin paths against node permissions. */
    private validateDisabled(paths: string[] | undefined, providedRoot?: import('./profile_node.js').NamespaceTreeNode): void {
        if (paths !== undefined && (!Array.isArray(paths) || paths.some(path => {
            if (typeof path !== 'string') return true;
            const root = providedRoot ? this.definitions.profile({ root: providedRoot }) : this.protectedNodes;
            const node = root.resolve(path);
            return !node || !node.permissions.disableable;
        }))) throw new Error('Invalid disabled protected-node paths');
    }

    tools(): PhysicalTool[] { return structuredClone([...this.physical.values()].filter(tool => !this.toolAdditions.get(tool.id).hidden).map(tool => ({ ...tool, provided: this.owns(tool.id), addition: (({ hidden, ptcDescription }) => ({ ...(hidden === undefined ? {} : { hidden }), ...(ptcDescription === undefined ? {} : { ptcDescription }) }))(this.toolAdditions.get(tool.id)) }))); }

    /** @brief Resolve a mount's description before the shared physical-tool preference. */
    description(path: string, tool: string): string | undefined {
        return settingsAt(this.state.nodeSettings, path.split('.'))?.description ?? this.state.mappings.find(mapping => mapping.path === path && mapping.id === tool)?.description ?? this.state.toolComments?.[tool];
    }

    effective(tools: readonly PhysicalTool[] = [...this.physical.values()]): Array<Mapping & { tool: PhysicalTool }> {
        const byId = new Map<string, Mapping[]>();
        for (const mapping of this.state.mappings) {
            const group = byId.get(mapping.id);
            if (group) group.push(mapping);
            else byId.set(mapping.id, [mapping]);
        }
        return tools.flatMap(tool => {
            const mappings = byId.get(tool.id) ?? [];
            return (mappings.length ? mappings : [{ id: tool.id,
                path: `tools.${tool.id.startsWith('tools_') ? tool.id.slice(6) : toolName(tool.id)}`,
                pinned: false, alwaysVisible: this.state.unmountedVisible?.[tool.id] ?? 0,
            }]).map(mapping => ({ ...mapping, description: mapping.description ?? this.state.toolComments?.[tool.id], tool }));
        });
    }

    /** @brief Validate each mount independently while rejecting overlapping callable paths. */
    private validateMappings(mappings: Mapping[]): void {
        const paths: string[] = [];
        for (const m of mappings) {
            if (!m || typeof m.id !== 'string' || typeof m.pinned !== 'boolean' || (m.description !== undefined && typeof m.description !== 'string') || (m.disabled !== undefined && typeof m.disabled !== 'boolean') || (m.alwaysVisible !== undefined && ![0, 1, 2].includes(m.alwaysVisible))) throw new Error('Invalid mapping');
            validatePath(m.path);
            if (paths.some(path => path === m.path || path.startsWith(`${m.path}.`) || m.path.startsWith(`${path}.`))) throw new Error(`Namespace collision: ${m.path}`);
            paths.push(m.path);
        }
    }

    /** @brief Fixed identities are derived from the initial Profile's concrete protected nodes. */
    owns(tool: string): boolean {
        return this.protectedDefinition.tools.has(tool);
    }

    /** @brief Reject new user mounts of fixed tools, retaining existing plugin-owned mounts. */
    private validateFixedMappings(mappings: Mapping[], original: Mapping[]): void {
        for (const mapping of mappings) if ((this.owns(mapping.id) || this.toolAdditions.get(mapping.id).hidden)
            && !original.some(previous => previous.id === mapping.id && previous.path === mapping.path)) throw new Error(`Fixed tool cannot be mounted: ${mapping.id}`);
    }

    /** @brief Validate namespace metadata against callable paths and reserved names. */
    private validateNamespaces(namespaces: Namespace[], mappings: Mapping[]): void {
        if (!Array.isArray(namespaces)) throw new Error('Invalid namespaces');
        const seen = new Set<string>();
        for (const entry of namespaces) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.alwaysVisible !== 'boolean' || typeof entry.description !== 'string' || (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') || seen.has(entry.path)) throw new Error('Invalid namespace');
            validatePath(`${entry.path}.namespace_check`);
            if (mappings.map(m => m.path).some(path => entry.path === path || entry.path.startsWith(`${path}.`))) throw new Error(`Namespace collision: ${entry.path}`);
            seen.add(entry.path);
        }
    }

    private transaction(operation: () => Promise<void>): Promise<void> {
        const result = this.writeChain.then(operation);
        this.writeChain = result.catch(() => {});
        return result;
    }

    /** @brief Validate namespace prompt visibility preferences. */
    private validateNamespaceVisible(value: unknown): void {
        if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([path, pinned]) => !path || typeof pinned !== 'boolean'))) throw new Error('Invalid namespace visibility preferences');
    }

    /** @brief Validate physical tool IDs and builtin paths used as visibility preferences. */
    private validateVisibility(ids: CommandVisibility): void {
        if (!ids || typeof ids !== 'object' || Array.isArray(ids) || Object.entries(ids).some(([id, level]) => !id || ![0, 1, 2].includes(level))) throw new Error('Invalid tool visibility');
    }

    /** @brief Save a configuration; an explicit editor target preserves the default profile even for named copies. */
    async configure(mappings: Mapping[], revision: number, namespaces?: Namespace[], order?: string[], unmountedVisible?: CommandVisibility, profile?: string, toolComments?: Record<string, string>, builtinVisible?: CommandVisibility, namespaceVisible?: Record<string, boolean>, editingProfile?: string, activate = true, builtinDisabled?: string[], brief?: string): Promise<void> {
        const detached = structuredClone(mappings);
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('registry_revision_conflict');
            if (profile !== undefined) {
                this.validateProfileName(profile);
                if (profile === (this.state.profile ?? 'Default') || Object.hasOwn(this.state.inactiveProfiles ?? {}, profile)) throw new Error('profile_name_exists');
            }
            const base: PlaneProfileData = !activate && profile !== undefined && editingProfile === undefined
                ? new PlaneProfile()
                : this.configuration(editingProfile);
            this.validateMappings(detached);
            this.validateFixedMappings(detached, base.mappings);
            this.validateNamespaceVisible(namespaceVisible);
            const comments = structuredClone(toolComments ?? base.toolComments ?? {});
            this.validateComments(comments);
            this.validateDisabled(builtinDisabled, base.providedRoot);
            const builtins = structuredClone(builtinVisible ?? base.builtinVisible ?? {});
            this.validateVisibility(builtins);
            const selected = structuredClone(unmountedVisible ?? base.unmountedVisible ?? {});
            this.validateVisibility(selected);
            for (const mapping of detached) {
                if (!base.mappings.some(old => old.id === mapping.id) && selected[mapping.id] && mapping.alwaysVisible === undefined) mapping.alwaysVisible = selected[mapping.id];
            }
            if (unmountedVisible === undefined) for (const old of base.mappings) {
                if (old.alwaysVisible && !detached.some(mapping => mapping.id === old.id)) selected[old.id] = old.alwaysVisible;
            }
            const metadata = structuredClone(namespaces ?? base.namespaces ?? []);
            this.validateNamespaces(metadata, detached);
            for (const m of detached) {
                if (!this.physical.has(m.id) && !base.mappings.some(old => old.id === m.id)) throw new Error(`Unknown physical identity: ${m.id}`);
            }
            for (const old of base.mappings) {
                if (old.pinned && !detached.some(m => m.id === old.id && m.path === old.path)) throw new Error(`Pinned mapping: ${old.id}`);
            }
            const requestedOrder = order ?? base.order ?? [];
            if (!Array.isArray(requestedOrder) || requestedOrder.some(path => typeof path !== 'string')) throw new Error('Invalid tree order');
            const known = new Set([...metadata.map(n => n.path), ...detached.map(m => m.path)]
                .flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))));
            const treeOrder = [...new Set([...requestedOrder, ...known])].filter(path => known.has(path));
            const configuration = { brief, providedRoot: base.providedRoot, nodeSettings: base.nodeSettings, builtinDisabled: builtinDisabled ?? base.builtinDisabled ?? [], mappings: detached, namespaces: metadata, order: treeOrder, toolComments: comments, builtinVisible: builtins, namespaceVisible: namespaceVisible ?? base.namespaceVisible ?? {},
                unmountedVisible: Object.fromEntries(Object.entries(selected).filter(([id]) => !detached.some(mapping => mapping.id === id))),
            };
            const targetName = profile ?? editingProfile ?? this.state.profile;
            validateProfileEdit(profileTree(targetName, base, this.definitions).root, profileTree(targetName, configuration, this.definitions).root, this.definitions);
            let next: PlaneProfileStateData = { ...this.state, revision: this.state.revision + 1 };
            if (editingProfile !== undefined || !activate) {
                const target = profile ?? editingProfile ?? this.state.profile ?? 'Default';
                if (target === (this.state.profile ?? 'Default')) next = { ...next, ...configuration };
                else next.inactiveProfiles = { ...this.state.inactiveProfiles, [target]: configuration };
            } else {
                next = { ...next, ...configuration };
                if (profile !== undefined) {
                    next.inactiveProfiles = { ...this.state.inactiveProfiles, [this.state.profile ?? 'Default']: this.configuration() };
                    next.profile = profile;
                }
            }
            const state = new PlaneProfileState(next);
            await this.persist(state, [targetName]);
            this.state = state;
        });
    }

}
