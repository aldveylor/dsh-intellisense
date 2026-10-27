import { CommandNode, NamespaceNode, createNamespace } from '../namespace/namespace.js';
import { pluginCommands } from '../runtime/builtins.js';
import { toolName, validatePath } from './path.js';
export { validatePath } from './path.js';
import type { Store } from '../storage/store.js';
import { RegistryConfiguration, RegistryState, type RegistryConfigurationData, type RegistryStateData } from './configuration.js';

/** @brief Stable physical identity and the enforced native JSON contracts. */
export interface PhysicalTool {
    id: string;
    source?: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
    /** @brief TypeScript return declaration supplied by the management API for display. */
    outputDeclaration?: string;
}

/** @brief Command prompt exposure: hidden, brief, or fully documented. */
export type PinLevel = 0 | 1 | 2;

/** @brief Profile pin levels indexed by physical tool ID or builtin path. */
export type CommandVisibility = Record<string, PinLevel>;

/** @brief Semantic naming, exposure and stable path configuration. */
export interface Mapping {
    id: string;
    path: string;
    description?: string;
    pinned: boolean;
    alwaysVisible?: PinLevel;
    disabled?: boolean;
}

/** @brief Persisted namespace documentation and unconditional prompt visibility. */
export interface Namespace { disabled?: boolean; path: string; alwaysVisible: boolean; description: string }

export { RegistryConfiguration, RegistryState } from './configuration.js';
export type { RegistryConfigurationData, RegistryStateData } from './configuration.js';

/** @brief Global configuration schema version, independent of the package version. */
const configurationVersion = 1;

/** @brief Transactional semantic registry; unconfigured identities use encoded tools paths. */
export class SemanticRegistry {
    private physical = new Map<string, PhysicalTool>();
    private physicalFingerprint = '';
    private physicalRevision = 0;
    private readonly protectedNodes = createNamespace({ tools: [], includeUnavailable: true });
    private state = new RegistryState({ inactiveProfiles: {} });
    private writeChain: Promise<unknown> = Promise.resolve();

    constructor(private store: Store, private readonly scope: 'global' | 'session' = 'global') {}

    async load(): Promise<void> {
        let saved = await this.store.load<RegistryStateData>('registry');
        if (saved !== undefined) {
            const migrate = this.scope === 'global' && (saved?.version ?? 0) !== configurationVersion;
            if (migrate) saved = this.recoverState(saved);
            saved = structuredClone(saved);
            let cleaned = this.pruneProtectedPreferences(saved);
            for (const configuration of Object.values(saved.inactiveProfiles ?? {})) {
                cleaned = this.pruneProtectedPreferences(configuration) || cleaned;
            }
            if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.mappings)) throw new Error('Invalid registry snapshot');
            this.validateProfileName(saved.profile ?? 'Default');
            this.validateMappings(saved.mappings);
            this.validateNamespaces(saved.namespaces ?? [], saved.mappings);
            this.validateVisibility(saved.unmountedVisible ?? {});
            this.validateVisibility(saved.builtinVisible ?? {});
            this.validateDisabled(saved.builtinDisabled);
            this.validateNamespaceVisible(saved.namespaceVisible);
            this.validateComments(saved.toolComments ?? {});
            for (const [name, configuration] of Object.entries(saved.inactiveProfiles ?? {})) {
                this.validateProfileName(name);
                if (name === (saved.profile ?? 'Default')) throw new Error('Duplicate active profile');
                this.validateMappings(configuration.mappings);
                this.validateNamespaces(configuration.namespaces, configuration.mappings);
                this.validateVisibility(configuration.unmountedVisible);
                this.validateVisibility(configuration.builtinVisible ?? {});
                this.validateDisabled(configuration.builtinDisabled);
                this.validateNamespaceVisible(configuration.namespaceVisible);
                this.validateComments(configuration.toolComments ?? {});
            }
            const state = new RegistryState(saved);
            if (migrate || cleaned) await this.store.save('registry', state.save());
            this.state = state;
        }
    }

    /** @brief Drop obsolete protected-node preferences on load while retaining configured namespace paths. */
    private pruneProtectedPreferences(configuration: Partial<RegistryConfigurationData>): boolean {
        const before = JSON.stringify(configuration);
        const paths = [
            ...(Array.isArray(configuration.mappings) ? configuration.mappings.map(item => item?.path) : []),
            ...(Array.isArray(configuration.namespaces) ? configuration.namespaces.map(item => item?.path) : []),
        ].filter((path): path is string => typeof path === 'string');
        const namespaceExists = (path: string): boolean => this.protectedNodes.resolve(path.split('.')) instanceof NamespaceNode
            || paths.some(configured => configured === path || configured.startsWith(path + '.'));
        if (Array.isArray(configuration.builtinDisabled)) configuration.builtinDisabled = configuration.builtinDisabled.filter(path =>
            typeof path !== 'string' || !!this.protectedNodes.resolve(path.split('.'))?.permissions.disableable);
        if (configuration.builtinVisible && typeof configuration.builtinVisible === 'object' && !Array.isArray(configuration.builtinVisible)) {
            configuration.builtinVisible = Object.fromEntries(Object.entries(configuration.builtinVisible).filter(([path]) =>
                this.protectedNodes.resolve(path.split('.')) instanceof CommandNode));
        }
        if (configuration.namespaceVisible && typeof configuration.namespaceVisible === 'object' && !Array.isArray(configuration.namespaceVisible)) {
            configuration.namespaceVisible = Object.fromEntries(Object.entries(configuration.namespaceVisible).filter(([path]) => namespaceExists(path)));
        }
        if (Array.isArray(configuration.order)) configuration.order = configuration.order.filter(path => typeof path !== 'string'
            || !!this.protectedNodes.resolve(path.split('.')) || namespaceExists(path));
        return before !== JSON.stringify(configuration);
    }

    /** @brief Recover independently loadable settings when the global schema version changes. */
    private recoverState(value: unknown): RegistryStateData {
        const saved = this.record(value);
        const profile = this.accepts(() => this.validateProfileName(saved.profile as string)) ? saved.profile as string : 'Default';
        const inactiveProfiles: Record<string, RegistryConfigurationData> = {};
        for (const [name, configuration] of Object.entries(this.record(saved.inactiveProfiles))) {
            if (name === profile || !this.accepts(() => this.validateProfileName(name))) continue;
            inactiveProfiles[name] = this.recoverConfiguration(configuration);
        }
        return { ...this.recoverConfiguration(saved), version: configurationVersion,
            revision: Number.isSafeInteger(saved.revision) ? saved.revision as number : 0, profile, inactiveProfiles };
    }

    /** @brief Discard invalid entries while retaining valid siblings and unrelated preferences. */
    private recoverConfiguration(value: unknown): RegistryConfigurationData {
        const saved = this.record(value);
        const mappings: Mapping[] = [];
        for (const mapping of Array.isArray(saved.mappings) ? saved.mappings : []) {
            if (this.accepts(() => this.validateMappings([...mappings, mapping]))) mappings.push(mapping);
        }
        const namespaces: Namespace[] = [];
        for (const namespace of Array.isArray(saved.namespaces) ? saved.namespaces : []) {
            if (this.accepts(() => this.validateNamespaces([...namespaces, namespace], mappings))) namespaces.push(namespace);
        }
        return { ...(typeof saved.brief === 'string' ? { brief: saved.brief } : {}), mappings, namespaces,
            order: Array.isArray(saved.order) ? [...new Set(saved.order.filter((path): path is string => typeof path === 'string'))] : [],
            unmountedVisible: this.recoverEntries<PinLevel>(saved.unmountedVisible, entry => this.validateVisibility(entry)),
            builtinVisible: saved.builtinVisible === undefined ? { ...pluginCommands.defaultBuiltinVisible }
                : this.recoverEntries<PinLevel>(saved.builtinVisible, entry => this.validateVisibility(entry)),
            namespaceVisible: this.recoverEntries<boolean>(saved.namespaceVisible, entry => this.validateNamespaceVisible(entry)),
            toolComments: this.recoverEntries<string>(saved.toolComments, entry => this.validateComments(entry)),
            builtinDisabled: Array.isArray(saved.builtinDisabled) ? saved.builtinDisabled.filter((path: unknown): path is string => this.accepts(() => this.validateDisabled([path as string]))) : [],
        };
    }

    /** @brief Treat malformed containers as empty without trusting persisted types. */
    private record(value: unknown): Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    /** @brief Reuse runtime validators to retain only supported dictionary entries. */
    private recoverEntries<T>(value: unknown, validate: (entry: Record<string, T>) => void): Record<string, T> {
        return Object.fromEntries(Object.entries(this.record(value)).filter(([key, entry]) => this.accepts(() => validate({ [key]: entry as T })))) as Record<string, T>;
    }

    /** @brief Convert only synchronous validation failures into discarded configuration data. */
    private accepts(validate: () => void): boolean {
        try { validate(); return true; }
        catch { return false; }
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

    /** @brief Identify configuration and physical-contract changes without copying either snapshot. */
    get generation(): string { return `${this.state.revision}:${this.physicalRevision}`; }

    /** @brief Read Profile names and selection without cloning configuration data. */
    profileSelection(): { profiles: string[]; selected: string } {
        const selected = this.state.profile ?? 'Default';
        return { selected, profiles: [selected, ...Object.keys(this.state.inactiveProfiles ?? {})].sort((a, b) => a.localeCompare(b)) };
    }

    snapshot(): RegistryState {
        const { inactiveProfiles: _inactiveProfiles, ...current } = this.state;
        const { selected: profile, profiles } = this.profileSelection();
        return new RegistryState({ ...current, profile, profiles });
    }

    /** @brief Read catalog descriptions without copying namespace trees. */
    profileBriefs(): Record<string, string> {
        const configurations = { ...this.state.inactiveProfiles, [this.state.profile]: this.state };
        return Object.fromEntries(Object.entries(configurations).flatMap(([name, configuration]) =>
            configuration.brief === undefined ? [] : [[name, configuration.brief]]));
    }

    /** @brief Extract only the configurable fields when archiving an active profile. */
    configuration(name = this.state.profile ?? 'Default'): RegistryConfiguration {
        this.validateProfileName(name);
        if (name !== (this.state.profile ?? 'Default')) {
            const configuration = Object.hasOwn(this.state.inactiveProfiles ?? {}, name) ? this.state.inactiveProfiles![name] : undefined;
            if (!configuration) throw new Error('Profile does not exist');
            return new RegistryConfiguration(configuration);
        }
        return new RegistryConfiguration(this.state);
    }

    /** @brief Replace one reference's working configuration without modifying other holders. */
    async replaceConfiguration(configuration: RegistryConfigurationData, profile: string): Promise<void> {
        const detached = new RegistryConfiguration(configuration);
        await this.transaction(async () => {
            this.validateProfileName(profile);
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateDisabled(detached.builtinDisabled);
            this.validateNamespaceVisible(detached.namespaceVisible);
            this.validateComments(detached.toolComments ?? {});
            const next: RegistryStateData = { ...this.state, ...detached, toolComments: detached.toolComments ?? {}, profile, revision: this.state.revision + 1 };
            const state = new RegistryState(next);
            await this.store.save('registry', state.save());
            this.state = state;
        });
    }

    /** @brief Publish a new named version; existing session references retain their own snapshots. */
    async saveProfile(name: string, configuration: RegistryConfigurationData): Promise<void> {
        const detached = new RegistryConfiguration(configuration);
        await this.transaction(async () => {
            this.validateProfileName(name);
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateDisabled(detached.builtinDisabled);
            this.validateNamespaceVisible(detached.namespaceVisible);
            this.validateComments(detached.toolComments ?? {});
            const next: RegistryStateData = { ...this.state, revision: this.state.revision + 1 };
            if (name === (this.state.profile ?? 'Default')) Object.assign(next, detached, { toolComments: detached.toolComments ?? {} });
            else next.inactiveProfiles = { ...this.state.inactiveProfiles, [name]: detached };
            const state = new RegistryState(next);
            await this.store.save('registry', state.save());
            this.state = state;
        });
    }

    /** @brief Tool-level comments also apply to tools that have no mounted path. */
    private validateComments(comments: Record<string, string>): void {
        if (!comments || typeof comments !== 'object' || Array.isArray(comments) || Object.values(comments).some(value => typeof value !== 'string')) throw new Error('Invalid tool comments');
    }

    /** @brief Keep names usable as both dictionary keys and menu labels. */
    private validateProfileName(name: string): void {
        if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid profile name');
    }

    /** @brief Atomically manage named configurations under the same global revision as ordinary saves. */
    async manageProfile(action: 'create' | 'select' | 'rename' | 'delete', name: string, revision: number, newName?: string, activate = true): Promise<void> {
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            this.validateProfileName(name);
            const active = this.state.profile ?? 'Default';
            const archive = this.state.save().inactiveProfiles ?? {};
            const exists = (name: string): boolean => name === active || Object.hasOwn(archive, name);
            let next: RegistryStateData = { ...this.state, revision: revision + 1, inactiveProfiles: archive };
            if (action === 'create') {
                if (exists(name)) throw new Error('Profile name already exists');
                const empty = new RegistryConfiguration();
                if (activate) {
                    archive[active] = this.configuration();
                    next = { ...next, ...empty, profile: name };
                } else archive[name] = empty;
            } else {
                if (!exists(name)) throw new Error('Profile does not exist');
                if (action === 'rename') {
                    this.validateProfileName(newName!);
                    if (newName === name) return;
                    if (exists(newName!)) throw new Error('Profile name already exists');
                    if (name === active) next.profile = newName!;
                    else { archive[newName!] = archive[name]!; delete archive[name]; }
                } else if (action === 'select') {
                    if (name === active) return;
                    const configuration = archive[name]!;
                    delete archive[name]; archive[active] = this.configuration();
                    next = { ...next, ...configuration, brief: configuration.brief, builtinDisabled: configuration.builtinDisabled ?? [], toolComments: configuration.toolComments ?? {}, namespaceVisible: configuration.namespaceVisible ?? {}, profile: name };
                } else if (action === 'delete') {
                    if (!Object.keys(archive).length) throw new Error('At least one profile is required');
                    if (name === active) {
                        const fallback = Object.keys(archive)[0]!;
                        next = { ...next, ...archive[fallback]!, brief: archive[fallback]!.brief, builtinDisabled: archive[fallback]!.builtinDisabled ?? [], toolComments: archive[fallback]!.toolComments ?? {}, namespaceVisible: archive[fallback]!.namespaceVisible ?? {}, profile: fallback }; delete archive[fallback];
                    } else delete archive[name];
                } else throw new Error('Invalid profile action');
            }
            const state = new RegistryState(next);
            await this.store.save('registry', state.save());
            this.state = state;
        });
    }

    /** @brief Resolve explicit command and inherited namespace disablement without dropping editor state. */
    disabled(path: string): boolean {
        const node = this.protectedNodes.resolve(path.split('.'));
        if (node && !node.permissions.disableable) return false;
        return [...(this.state.builtinDisabled ?? []), ...(this.state.namespaces ?? []).filter(node => node.disabled).map(node => node.path)]
            .some(prefix => path === prefix || path.startsWith(prefix + '.'))
            || this.state.mappings.some(mapping => mapping.disabled && mapping.path === path);
    }

    /** @brief Validate disabled builtin paths against node permissions. */
    private validateDisabled(paths: string[] | undefined): void {
        if (paths !== undefined && (!Array.isArray(paths) || paths.some(path => {
            if (typeof path !== 'string') return true;
            const node = this.protectedNodes.resolve(path.split('.'));
            return !node || !node.permissions.disableable;
        }))) throw new Error('Invalid disabled protected-node paths');
    }

    tools(): PhysicalTool[] { return structuredClone([...this.physical.values()]); }

    /** @brief Resolve a mount's description before the shared physical-tool preference. */
    description(path: string, tool: string): string | undefined {
        return this.state.mappings.find(mapping => mapping.path === path && mapping.id === tool)?.description ?? this.state.toolComments?.[tool];
    }

    effective(): Array<Mapping & { tool: PhysicalTool }> {
        const byId = new Map<string, Mapping[]>();
        for (const mapping of this.state.mappings) {
            const group = byId.get(mapping.id);
            if (group) group.push(mapping);
            else byId.set(mapping.id, [mapping]);
        }
        return [...this.physical.values()].flatMap(tool => {
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
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            if (profile !== undefined) {
                this.validateProfileName(profile);
                if (profile === (this.state.profile ?? 'Default') || Object.hasOwn(this.state.inactiveProfiles ?? {}, profile)) throw new Error('Profile name already exists');
            }
            const base: RegistryConfigurationData = !activate && profile !== undefined && editingProfile === undefined
                ? new RegistryConfiguration()
                : this.configuration(editingProfile);
            this.validateMappings(detached);
            this.validateNamespaceVisible(namespaceVisible);
            const comments = structuredClone(toolComments ?? base.toolComments ?? {});
            this.validateComments(comments);
            this.validateDisabled(builtinDisabled);
            const builtins = structuredClone(builtinVisible ?? base.builtinVisible ?? pluginCommands.defaultBuiltinVisible);
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
            const configuration = { brief, builtinDisabled: builtinDisabled ?? base.builtinDisabled ?? [], mappings: detached, namespaces: metadata, order: treeOrder, toolComments: comments, builtinVisible: builtins, namespaceVisible: namespaceVisible ?? base.namespaceVisible ?? {},
                unmountedVisible: Object.fromEntries(Object.entries(selected).filter(([id]) => !detached.some(mapping => mapping.id === id))),
            };
            let next: RegistryStateData = { ...this.state, revision: this.state.revision + 1 };
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
            const state = new RegistryState(next);
            await this.store.save('registry', state.save());
            this.state = state;
        });
    }

}
