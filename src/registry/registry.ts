import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import { defaultBuiltinVisible } from '../runtime/builtins.js';
import { toolName, validatePath } from './path.js';
export { validatePath } from './path.js';
import type { Store } from '../storage/store.js';

/** @brief Stable physical identity and the enforced native JSON contracts. */
export interface PhysicalTool {
    id: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
}

/** @brief Command prompt exposure: hidden, brief, or fully documented. */
export type PinLevel = 0 | 1 | 2;

/** @brief Profile pin levels indexed by physical tool ID or builtin path. */
export type CommandVisibility = Record<string, PinLevel>;

/** @brief Semantic naming, exposure and stable path configuration. */
export interface Mapping {
    id: string;
    path: string;
    aliases: string[];
    description?: string;
    enabled: boolean;
    pinned: boolean;
    alwaysVisible?: PinLevel;
}

/** @brief Persisted namespace documentation and unconditional prompt visibility. */
export interface Namespace { path: string; alwaysVisible: boolean; description: string }

/** @brief Successful physical invocations, independent of completion exposure. */
export interface Usage { calls: number; lastUsed: number; exposures: number }
/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryState { version: 1; revision: number; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; unmountedVisible?: CommandVisibility; builtinVisible?: CommandVisibility; consolePinned?: boolean; toolComments?: Record<string, string>; profile?: string; profiles?: string[]; usage: Record<string, Usage> }
/** @brief A named configuration contains no runtime state or usage counters. */
export interface RegistryConfiguration { mappings: Mapping[]; namespaces: Namespace[]; order: string[]; unmountedVisible: CommandVisibility; builtinVisible?: CommandVisibility; consolePinned?: boolean; toolComments?: Record<string, string> }
/** @brief Only inactive configurations are archived, so the active configuration has one source of truth. */
interface StoredRegistryState extends RegistryState { inactiveProfiles?: Record<string, RegistryConfiguration> }

/** @brief Transactional semantic registry; unconfigured identities use encoded tools paths. */
export class SemanticRegistry {
    private physical = new Map<string, PhysicalTool>();
    private state: StoredRegistryState = { version: 1, revision: 0, mappings: [], usage: {}, profile: 'Default', inactiveProfiles: {} };
    private writeChain: Promise<unknown> = Promise.resolve();

    constructor(private store: Store, private usageOwner?: SemanticRegistry) {}

    async load(): Promise<void> {
        const saved = await this.store.load<StoredRegistryState>('registry');
        if (saved) {
            if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.mappings) || !saved.usage) throw new Error('Invalid registry snapshot');
            this.validateProfileName(saved.profile ?? 'Default');
            this.validateMappings(saved.mappings);
            this.validateNamespaces(saved.namespaces ?? [], saved.mappings);
            this.validateVisibility(saved.unmountedVisible ?? {});
            this.validateVisibility(saved.builtinVisible ?? {});
            this.validateConsolePinned(saved.consolePinned);
            this.validateComments(saved.toolComments ?? {});
            for (const [name, configuration] of Object.entries(saved.inactiveProfiles ?? {})) {
                this.validateProfileName(name);
                if (name === (saved.profile ?? 'Default')) throw new Error('Duplicate active profile');
                this.validateMappings(configuration.mappings);
                this.validateNamespaces(configuration.namespaces, configuration.mappings);
                this.validateVisibility(configuration.unmountedVisible);
                this.validateVisibility(configuration.builtinVisible ?? {});
                this.validateConsolePinned(configuration.consolePinned);
                this.validateComments(configuration.toolComments ?? {});
            }
            this.state = saved;
        }
    }

    refresh(tools: PhysicalTool[]): void {
        if (new Set(tools.map(t => t.id)).size !== tools.length) throw new Error('Duplicate physical tool identity');
        const next = new Map(tools.map(t => [t.id, structuredClone(t)]));
        // Identifier escaping preserves physical names without merging distinct identities.
        this.physical = next;
    }

    snapshot(): RegistryState {
        const { inactiveProfiles, ...state } = structuredClone(this.state);
        const profile = state.profile ?? 'Default';
        return { ...state, usage: this.usageOwner?.snapshot().usage ?? state.usage, profile, profiles: [profile, ...Object.keys(inactiveProfiles ?? {})].sort((a, b) => a.localeCompare(b)) };
    }

    /** @brief Extract only the configurable fields when archiving an active profile. */
    configuration(name = this.state.profile ?? 'Default'): RegistryConfiguration {
        this.validateProfileName(name);
        if (name !== (this.state.profile ?? 'Default')) {
            const configuration = Object.hasOwn(this.state.inactiveProfiles ?? {}, name) ? this.state.inactiveProfiles![name] : undefined;
            if (!configuration) throw new Error('Profile does not exist');
            return structuredClone(configuration);
        }
        return structuredClone({ mappings: this.state.mappings, namespaces: this.state.namespaces ?? [], order: this.state.order ?? [], unmountedVisible: this.state.unmountedVisible ?? {}, toolComments: this.state.toolComments ?? {}, builtinVisible: this.state.builtinVisible ?? defaultBuiltinVisible, consolePinned: this.state.consolePinned ?? false });
    }

    /** @brief Replace one reference's working configuration without modifying other holders. */
    async replaceConfiguration(configuration: RegistryConfiguration, profile: string): Promise<void> {
        const detached = structuredClone(configuration);
        detached.builtinVisible ??= { ...defaultBuiltinVisible };
        detached.consolePinned ??= false;
        await this.transaction(async () => {
            this.validateProfileName(profile);
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateConsolePinned(detached.consolePinned);
            this.validateComments(detached.toolComments ?? {});
            const next = { ...this.state, ...detached, toolComments: detached.toolComments ?? {}, profile, revision: this.state.revision + 1 };
            await this.store.save('registry', next);
            this.state = next;
        });
    }

    /** @brief Publish a new named version; existing session references retain their own snapshots. */
    async saveProfile(name: string, configuration: RegistryConfiguration): Promise<void> {
        const detached = structuredClone(configuration);
        detached.builtinVisible ??= { ...defaultBuiltinVisible };
        detached.consolePinned ??= false;
        await this.transaction(async () => {
            this.validateProfileName(name);
            this.validateMappings(detached.mappings);
            this.validateNamespaces(detached.namespaces, detached.mappings);
            this.validateVisibility(detached.unmountedVisible);
            this.validateVisibility(detached.builtinVisible ?? {});
            this.validateConsolePinned(detached.consolePinned);
            this.validateComments(detached.toolComments ?? {});
            const next = { ...this.state, revision: this.state.revision + 1 };
            if (name === (this.state.profile ?? 'Default')) Object.assign(next, detached, { toolComments: detached.toolComments ?? {} });
            else next.inactiveProfiles = { ...this.state.inactiveProfiles, [name]: detached };
            await this.store.save('registry', next);
            this.state = next;
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
    async manageProfile(action: 'create' | 'select' | 'rename' | 'delete', name: string, revision: number, newName?: string): Promise<void> {
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            this.validateProfileName(name);
            const active = this.state.profile ?? 'Default';
            const archive = structuredClone(this.state.inactiveProfiles ?? {});
            const exists = (name: string): boolean => name === active || Object.hasOwn(archive, name);
            let next = { ...this.state, revision: revision + 1, inactiveProfiles: archive };
            if (action === 'create') {
                if (exists(name)) throw new Error('Profile name already exists');
                archive[active] = this.configuration();
                next = { ...next, profile: name, mappings: [], namespaces: [], order: [], unmountedVisible: {}, consolePinned: false, builtinVisible: { ...defaultBuiltinVisible }, toolComments: {} };
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
                    next = { ...next, ...configuration, toolComments: configuration.toolComments ?? {}, consolePinned: configuration.consolePinned ?? false, profile: name };
                } else if (action === 'delete') {
                    if (!Object.keys(archive).length) throw new Error('At least one profile is required');
                    if (name === active) {
                        const fallback = Object.keys(archive)[0]!;
                        next = { ...next, ...archive[fallback]!, toolComments: archive[fallback]!.toolComments ?? {}, consolePinned: archive[fallback]!.consolePinned ?? false, profile: fallback }; delete archive[fallback];
                    } else delete archive[name];
                } else throw new Error('Invalid profile action');
            }
            await this.store.save('registry', next);
            this.state = next;
        });
    }

    tools(): PhysicalTool[] { return structuredClone([...this.physical.values()]); }

    effective(): Array<Mapping & { tool: PhysicalTool }> {
        return [...this.physical.values()].map(tool => {
            const mapping = this.state.mappings.find(m => m.id === tool.id);
            return {
                id: tool.id,
                path: `tools.${tool.id.startsWith('tools_') ? tool.id.slice(6) : toolName(tool.id)}`,
                aliases: [], enabled: true, pinned: false,
                alwaysVisible: mapping?.alwaysVisible ?? ((this.state.unmountedVisible ?? {})[tool.id] ?? 0),
                ...mapping, description: Object.hasOwn(this.state.toolComments ?? {}, tool.id) ? this.state.toolComments![tool.id] : mapping?.description, tool,
            };
        });
    }

    private validateMappings(mappings: Mapping[]): void {
        const ids = new Set<string>();
        const paths: string[] = [];
        for (const m of mappings) {
            if (!m || typeof m.id !== 'string' || ids.has(m.id) || !Array.isArray(m.aliases) || m.aliases.some(a => typeof a !== 'string') || typeof m.enabled !== 'boolean' || typeof m.pinned !== 'boolean' || (m.description !== undefined && typeof m.description !== 'string') || (m.alwaysVisible !== undefined && ![0, 1, 2].includes(m.alwaysVisible))) throw new Error('Invalid mapping');
            ids.add(m.id);
            for (const path of [m.path, ...m.aliases]) {
                validatePath(path);
                if (paths.some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`))) throw new Error(`Namespace collision: ${path}`);
                paths.push(path);
            }
        }
    }

    /** @brief Validate namespace metadata against callable paths and reserved names. */
    private validateNamespaces(namespaces: Namespace[], mappings: Mapping[]): void {
        if (!Array.isArray(namespaces)) throw new Error('Invalid namespaces');
        const seen = new Set<string>();
        for (const entry of namespaces) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.alwaysVisible !== 'boolean' || typeof entry.description !== 'string' || seen.has(entry.path)) throw new Error('Invalid namespace');
            validatePath(`${entry.path}.namespace_check`);
            if (mappings.flatMap(m => [m.path, ...m.aliases]).some(path => entry.path === path || entry.path.startsWith(`${path}.`))) throw new Error(`Namespace collision: ${entry.path}`);
            seen.add(entry.path);
        }
    }

    private transaction(operation: () => Promise<void>): Promise<void> {
        const result = this.writeChain.then(operation);
        this.writeChain = result.catch(() => {});
        return result;
    }

    /** @brief Validate optional console namespace prompt pinning independently of native runtime globals. */
    private validateConsolePinned(value: unknown): void {
        if (value !== undefined && typeof value !== 'boolean') throw new Error('Invalid console pin preference');
    }

    /** @brief Validate physical tool IDs and builtin paths used as visibility preferences. */
    private validateVisibility(ids: CommandVisibility): void {
        if (!ids || typeof ids !== 'object' || Array.isArray(ids) || Object.entries(ids).some(([id, level]) => !id || ![0, 1, 2].includes(level))) throw new Error('Invalid tool visibility');
    }

    /** @brief Save a configuration, optionally archiving the active profile and selecting a new named copy. */
    async configure(mappings: Mapping[], revision: number, namespaces?: Namespace[], order?: string[], unmountedVisible?: CommandVisibility, profile?: string, toolComments?: Record<string, string>, builtinVisible?: CommandVisibility, consolePinned?: boolean): Promise<void> {
        const detached = structuredClone(mappings);
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            if (profile !== undefined) {
                this.validateProfileName(profile);
                if (profile === (this.state.profile ?? 'Default') || Object.hasOwn(this.state.inactiveProfiles ?? {}, profile)) throw new Error('Profile name already exists');
            }
            this.validateMappings(detached);
            this.validateConsolePinned(consolePinned);
            const comments = structuredClone(toolComments ?? this.state.toolComments ?? {});
            this.validateComments(comments);
            const builtins = structuredClone(builtinVisible ?? this.state.builtinVisible ?? defaultBuiltinVisible);
            this.validateVisibility(builtins);
            const selected = structuredClone(unmountedVisible ?? this.state.unmountedVisible ?? {});
            this.validateVisibility(selected);
            for (const mapping of detached) {
                if (!this.state.mappings.some(old => old.id === mapping.id) && selected[mapping.id] && mapping.alwaysVisible === undefined) mapping.alwaysVisible = selected[mapping.id];
            }
            if (unmountedVisible === undefined) for (const old of this.state.mappings) {
                if (old.alwaysVisible && !detached.some(mapping => mapping.id === old.id)) selected[old.id] = old.alwaysVisible;
            }
            const metadata = structuredClone(namespaces ?? this.state.namespaces ?? []);
            this.validateNamespaces(metadata, detached);
            for (const m of detached) {
                if (!this.physical.has(m.id) && !this.state.mappings.some(old => old.id === m.id)) throw new Error(`Unknown physical identity: ${m.id}`);
                const old = this.state.mappings.find(o => o.id === m.id);
                if (old?.pinned && (old.path !== m.path || JSON.stringify(old.aliases) !== JSON.stringify(m.aliases))) throw new Error(`Pinned mapping: ${m.id}`);
            }
            for (const old of this.state.mappings) {
                if (old.pinned && !detached.some(m => m.id === old.id)) throw new Error(`Pinned mapping: ${old.id}`);
            }
            const requestedOrder = order ?? this.state.order ?? [];
            if (!Array.isArray(requestedOrder) || requestedOrder.some(path => typeof path !== 'string')) throw new Error('Invalid tree order');
            const known = new Set([...metadata.map(n => n.path), ...detached.flatMap(m => [m.path, ...m.aliases])]
                .flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))));
            const treeOrder = [...new Set([...requestedOrder, ...known])].filter(path => known.has(path));
            const next = { ...this.state, revision: this.state.revision + 1, mappings: detached, namespaces: metadata, order: treeOrder, toolComments: comments, builtinVisible: builtins, consolePinned: consolePinned ?? this.state.consolePinned ?? false,
                unmountedVisible: Object.fromEntries(Object.entries(selected).filter(([id]) => !detached.some(mapping => mapping.id === id))),
            };
            if (profile !== undefined) {
                next.inactiveProfiles = { ...this.state.inactiveProfiles, [this.state.profile ?? 'Default']: this.configuration() };
                next.profile = profile;
            }
            await this.store.save('registry', next);
            this.state = next;
        });
    }

    declarations(allowed?: Set<string>): string {
        const tree: Record<string, unknown> = Object.create(null);
        const rootFunctions: string[] = [];
        for (const mapping of this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)))) {
            const doc = mapping.tool.description.replaceAll('*/', '* /');
            const signature = `(args: ${jsonSchemaToTs(mapping.tool.parameters)}) => Promise<${jsonSchemaToTs(mapping.tool.output)}>`;
            for (const path of [mapping.path, ...mapping.aliases]) {
                const parts = path.split('.');
                if (parts.length === 1) { rootFunctions.push(`/** ${doc} */\ndeclare const ${path}: ${signature};`); continue; }
                let node = tree;
                for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
                node[parts.at(-1)!] = `/** ${doc} */\n${JSON.stringify(parts.at(-1)!)}: ${signature};`;
            }
        }
        const doc = (path: string): string => {
            const description = this.state.namespaces?.find(n => n.path === path)?.description;
            return description ? `/** ${description.replaceAll('*/', '* /')} */\n` : '';
        };
        const render = (node: Record<string, unknown>, path: string): string => `{\n${Object.entries(node).map(([k, v]) => typeof v === 'string' ? v : `${doc(`${path}.${k}`)}${JSON.stringify(k)}: ${render(v as Record<string, unknown>, `${path}.${k}`)};`).join('\n')} }`;
        return [...rootFunctions, ...Object.entries(tree).map(([key, value]) => `${doc(key)}declare const ${key}: ${render(value as Record<string, unknown>, key)};`)].join('\n');
    }

    /** @brief Include configured namespace hints only when an agent can access a descendant. */
    namespaceVisibility(allowed?: Set<string>): string[] {
        const visible = this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)));
        const paths = visible.flatMap(m => [m.path, ...m.aliases]);
        return [
            ...(this.state.namespaces ?? []).filter(n => n.alwaysVisible && paths.some(path => path.startsWith(`${n.path}.`)))
                .map(n => `${n.path}${n.description ? ` — ${n.description}` : ''}`),
            ...visible.filter(m => m.alwaysVisible).flatMap(m => [m.path, ...m.aliases]
                .map(path => m.alwaysVisible === 2 ? `${path}(args: ${jsonSchemaToTs(m.tool.parameters)}) => Promise<${jsonSchemaToTs(m.tool.output)}>\n/** @brief ${m.tool.description}\n * @param args Tool arguments\n * @returns Tool result\n */` : `${path} — ${m.description ?? m.tool.description}`)),
        ];
    }

    roots(): string[] { return [...new Set(this.effective().filter(m => m.enabled).flatMap(m => [m.path, ...m.aliases].map(p => p.split('.')[0]!)))].sort(); }

    /** @brief Reuse durable successful-call statistics for visible namespace discovery. */
    namespaceHints(allowed?: Set<string>, limit = 8): { frequent: string[]; recent: string[] } {
        const usage = this.snapshot().usage;
        const used = this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)) && (usage[m.id]?.calls ?? 0) > 0);
        const calls = (id: string): Usage => usage[id]!;
        const paths = (mappings: Mapping[]): string[] => [...new Set(mappings.flatMap(m => [m.path, ...m.aliases]))].slice(0, limit);
        return {
            frequent: paths([...used].sort((a, b) => calls(b.id).calls - calls(a.id).calls || calls(b.id).lastUsed - calls(a.id).lastUsed || a.path.localeCompare(b.path))),
            recent: paths([...used].sort((a, b) => calls(b.id).lastUsed - calls(a.id).lastUsed || a.path.localeCompare(b.path))),
        };
    }

    async invoke(path: string, args: unknown, dispatch: (id: string, args: unknown) => Promise<unknown>): Promise<unknown> {
        const mapping = this.effective().find(m => m.path === path || m.aliases.includes(path));
        if (!mapping?.enabled) throw new Error(`Execution denied: ${path}`);
        const errors = validateJsonSchemaValue(mapping.tool.parameters as JsonSchemaNode, args);
        if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
        const value = await dispatch(mapping.id, args);
        await (this.usageOwner ?? this).recordInvocation(mapping.id);
        return value;
    }

    /** @brief Store global usage independently of immutable configuration versions. */
    private async recordInvocation(id: string): Promise<void> {
        await this.transaction(async () => {
            const next = structuredClone(this.state);
            const usage = (Object.hasOwn(next.usage, id) ? next.usage[id] : undefined) ?? { calls: 0, lastUsed: 0, exposures: 0 };
            Object.defineProperty(next.usage, id, { value: { ...usage, calls: usage.calls + 1, lastUsed: Date.now() }, enumerable: true, configurable: true, writable: true });
            await this.store.save('registry', next);
            this.state = next;
        });
    }

    async expose(paths: string[]): Promise<void> {
        const ids = [...new Set(this.effective().filter(m => paths.includes(m.path) || m.aliases.some(a => paths.includes(a))).map(m => m.id))];
        await (this.usageOwner ?? this).recordExposures(ids);
    }

    /** @brief Attribute exposure by physical identity across session-local configurations. */
    private async recordExposures(ids: string[]): Promise<void> {
        await this.transaction(async () => {
            const next = structuredClone(this.state);
            for (const id of ids) {
                const usage = (Object.hasOwn(next.usage, id) ? next.usage[id] : undefined) ?? { calls: 0, lastUsed: 0, exposures: 0 };
                Object.defineProperty(next.usage, id, { value: { ...usage, exposures: usage.exposures + 1 }, enumerable: true, configurable: true, writable: true });
            }
            await this.store.save('registry', next);
            this.state = next;
        });
    }
}
