import type { Intellisense } from './intellisense.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import { editedConfiguration } from '../registry/profile/configuration.js';
import { outputSchema } from '../output_schema.js';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import * as presentation from '../integration/presentation.js';
import type { Position } from '../protocol/events.js';
import { symbols, type Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { scopeChainOf, type ScopeKey } from '@deepseek-ai/dsh-scope';
import '@deepseek-ai/dsh-agent-preset-registry';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { declaration, manifest, type Aliases, NamespaceNode, type CommandNode } from '../namespace/namespace.js';
import { namespaceDirectory, nativeDirectory, type NamespaceHint } from '../namespace/prompt.js';

import { type CommandBrief, type Profiles } from '../registry/profile_tree.js';
import type { z } from 'zod';
import { registerSearch } from '../tools/tool_search.js';
import { inspectionTree, inspectionBrief, registerInspect } from '../tools/inspect.js';
import { registerToolCommands } from '../tools/tool_commands.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from '../namespace/native_tools.js';

import { createSearchEngines } from '../search/search.js';
import { NamespaceComponent } from '../namespace/component.js';

/** @brief Own Agent session Profiles, discovery, presentation and native execution integration. */
export class NamespaceIntegration {
    readonly intellisense: Intellisense;

    private refreshedRevision = '';
    private refreshing?: Promise<void>;
    private generatedTools = new WeakSet<ToolDefinition>();
    private physicalSources = new WeakMap<Agent, { registry: SemanticRegistry; tools: object; revision: string; chain: ScopeKey[] }>();
    private positions = new Map<string, Position>();
    private discovered = new Map<string, Set<string>>();
    private nativeTools = new Map<string, { source: string; names: string[]; fingerprint: string; disposers: (() => void)[] }>();

    private catalogRevision = 0;
    private get catalogVersion(): string { return `${this.catalogRevision}:${this.registry.definitions.revision}`; }

    constructor(private ctx: Context, readonly namespace: NamespaceComponent, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases> = [], readonly searchEngines = createSearchEngines(), readonly statistics = profiles.statistics, readonly inspectStatistics = profiles.inspectStatistics) {
        this.intellisense = { profiles: namespace, statistics, inspectStatistics, searchEngines };
        ctx.effect(() => async () => { await Promise.all([...new Set([...this.nativeTools.keys(), ...this.positions.keys(), ...this.discovered.keys()])].map(id => this.release(id))); await this.statistics.dispose(); await this.inspectStatistics.dispose(); });
        ctx.on('tools/change', () => { this.catalogRevision++; });
        ctx.on('agent/request', async (payload, next) => {
            if (this.enabled(payload.agent)) this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    private get registry(): SemanticRegistry { return this.namespace.registry; }

    /** @brief Read the current conversation snapshot. */
    async get(agent: Agent): Promise<ProfileSnapshot> {
        await this.registryFor(agent);
        return (await this.profiles.addition(agent.session)).profile;
    }

    /** @brief Publish a conversation edit without changing its catalog Profile. */
    edit(agent: Agent, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot> {
        return this.namespace.profileTransaction(async () => {
            const registry = await this.registryFor(agent);
            const revision = registry.revision;
            const output = modifier((await this.get(agent)).clone());
            if (!output || typeof output.serialize !== 'function') throw new Error('Profile modifier must return a snapshot');
            const published = registry.definitions.profile({ brief: output.brief, root: output.serialize() });
            const name = registry.profileSelection().selected;
            await registry.saveProfile(name, editedConfiguration({ name, brief: published.brief, root: published.serialize() }, registry.configuration(), registry.definitions), { trusted: true, revision });
            await this.configurationChanged(agent);
            return published;
        });
    }

    /** @brief List catalog commands with mount paths including disabled paths, excluding plugin builtins. */
    async commandBriefs(agent?: Agent, current?: SemanticRegistry): Promise<CommandBrief[]> {
        await this.refresh();
        const registry = current ?? (agent ? await this.registryFor(agent) : this.registry);
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
        const callsByTool = await this.statistics.calls.snapshot();
        return this.registry.tools().filter(tool => !this.registry.definitions.addition(tool.id).hidden && !this.registry.definitions.addition(tool.id).fixed).map(tool => ({
            name: tool.id, brief: tool.description, paths: paths.get(tool.id) ?? [], totalCalls: Object.hasOwn(callsByTool, tool.id) ? callsByTool[tool.id]! : 0,
        }));
    }

    /** @brief Read catalog names separately from the conversation's selected Profile. */
    async profileNames(agent?: Agent, current?: SemanticRegistry): Promise<Profiles> {
        const registry = current ?? (agent ? await this.registryFor(agent) : this.registry);
        return { profiles: this.registry.profileSelection().profiles, selected: registry.profileSelection().selected };
    }

    /** @brief Compute only enabled Profile metadata before guest execution. */
    async values(agent?: Agent, current?: SemanticRegistry): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>> {
        const registry = current ?? (agent ? await this.registryFor(agent) : this.registry);
        const mode = agent && !this.isPtc(agent) ? 'native' : 'ptc';
        const values: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
        const root = manifest(registry, this.aliases ?? [], mode);
        for (const entry of root.commands()) {
            if (entry.disabled) continue;
            const producer = registry.definitions.addition(entry.tool).value;
            if (producer) values[entry.path] = await producer.read({ commandBriefs: current => this.commandBriefs(agent, current), profileNames: current => this.profileNames(agent, current) }, registry);
        }
        return values;
    }

    /** @brief Register builtin tools in the owning presentation scope. */
    register(ctx: Context): void {
        registerInspect(ctx, this);
        registerSearch(ctx, this);
        registerToolCommands(ctx, this.registry, this.profiles, agent => this.registryFor(agent), agent => this.configurationChanged(agent), agent => this.commandBriefs(agent), this);
    }

    /** @brief Enable namespaces only for an explicitly configured Intellisense scope. */
    enabled(agent: Agent): boolean { return presentation.presentationFor(agent.ctx) !== undefined; }

    /** @brief Read the Profile fixed by the nearest presentation configuration. */
    fixedProfile(agent: Agent): string | undefined { return presentation.presentationConfigFor(agent.ctx)?.profile; }

    /** @brief Use the same scoped presentation config for runtime bindings and initial prompts. */
    isPtc(agent: Agent): boolean {
        return presentation.presentationFor(agent.ctx) === 'ptc';
    }

    /** @brief Initialize only sessions belonging to an Intellisense presentation scope. */
    async configure(agent: Agent): Promise<void> {
        if (!this.enabled(agent)) return;
        this.catalogRevision++;
        if (!this.isPtc(agent)) await this.syncNative(agent);
        else await this.registryFor(agent);
    }

    /** @brief Read the native loop position for ordinary tool query audit events. */
    position(agent: Agent): Position { return this.positions.get(agent.id) ?? { turn: 0, step: 0 }; }

    /** @brief Read only the native tool catalog visible to this agent. */
    physical(agent?: Agent, scope: ScopeKey | undefined = agent): PhysicalTool[] {
        const tools = agent?.ctx.tools ?? this.ctx.tools;
        return tools.schemas(scope).flatMap(tool => {
            if (this.registry.definitions.addition(tool.name).hidden) return [];
            const definition = tools.get(tool.name, scope);
            if (!definition) {
                this.ctx.logger.warn(`Tool schema has no definition: ${tool.name}`);
                return [];
            }
            if (this.generatedTools.has(definition)) return [];
            return [{ id: tool.name, description: tool.description, parameters: tool.parameters, output: outputSchema(definition.output.schema) }];
        });
    }

    /** @brief Include standing preset tools in the editor catalog even without live conversations. */
    async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;
        if (this.refreshedRevision === this.catalogVersion) return;
        const revision = this.catalogVersion;
        const work = this.refreshCatalog();
        this.refreshing = work;
        try { await work; this.refreshedRevision = revision; }
        finally { this.refreshing = undefined; }
    }

    /** @brief Rebuild the shared catalog only after tool availability changes. */
    private async refreshCatalog(): Promise<void> {
        const tools = new Map(this.physical().map(tool => [tool.id, tool]));
        const presets = this.ctx.get('agentPresets');
        if (presets) for (const preset of await presets.list()) {
            if (preset.broken) continue;
            const scope = await presets.acquireScope(preset.id);
            try {
                for (const tool of this.physical(undefined, scope.key)) tools.set(tool.id, tool);
            } finally { await scope[Symbol.asyncDispose](); }
        }
        for (const agent of this.ctx.agents.list()) for (const tool of this.physical(agent)) tools.set(tool.id, tool);
        this.registry.refresh([...tools.values()]);
    }

    /** @brief Initialize child Profiles from their live parent's working copy, then retain independent snapshots. */
    async registryFor(agent?: Agent): Promise<SemanticRegistry> {
        if (!agent) { await this.refresh(); return this.registry; }
        const profile = this.fixedProfile(agent);
        const registry = await this.profiles.forSession(agent.session, async () => {
            const parent = this.ctx.agents.list().find(candidate => candidate !== agent && this.ctx.agents.isOwnedBy(agent.id, candidate));
            return parent && this.enabled(parent) ? this.registryFor(parent) : this.registry;
        }, profile);
        if (profile !== undefined && registry.profileSelection().selected !== profile) await this.profiles.load(agent.session, profile);
        const chain = scopeChainOf(agent);
        const tools: object = Reflect.get(agent.ctx.tools, symbols.original) ?? agent.ctx.tools;
        const previous = this.physicalSources.get(agent);
        if (!previous || previous.registry !== registry || previous.tools !== tools || previous.revision !== this.catalogVersion
            || previous.chain.length !== chain.length || previous.chain.some((scope, index) => scope !== chain[index])) {
            registry.refresh(this.physical(agent));
            this.physicalSources.set(agent, { registry, tools, revision: this.catalogVersion, chain });
        }
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async tree(agent: Agent, current?: SemanticRegistry): Promise<NamespaceNode> {
        const registry = current ?? await this.registryFor(agent);
        return manifest(registry, this.aliases, this.isPtc(agent) ? 'ptc' : 'native');
    }

    /** @brief Flatten command bindings only for consumers that dispatch physical tools. */
    async entries(agent: Agent, current?: SemanticRegistry): Promise<CommandNode[]> { return (await this.tree(agent, current)).commands().filter(entry => !entry.disabled); }

    /** @brief Refresh tool presentation after the conversation configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> {
        if (!this.isPtc(agent)) await this.syncNative(agent);
        this.ctx.emit('system-prompt/change');
    }

    /** @brief Publish only explicitly pinned commands and namespaces with their Profile briefs. */
    async prompt(agent: Agent): Promise<string> {
        const ptc = this.isPtc(agent);
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        const root = await this.tree(agent, registry);
        const hints: NamespaceHint[] = [];
        const mappings = new Map(registry.effective().map(mapping => [mapping.path, mapping]));
        for (const entry of root.commands()) {
            if (entry.disabled) continue;
            if (entry.provided) {
                const level = entry.fixLevel(state.builtinVisible?.[entry.path] ?? entry.fixedLevel);
                if (level && (ptc || level === 1)) hints.push({ path: entry.path, description: entry.doc,
                    ...(level === 2 ? { declaration: entry.preload ? `/** @brief ${entry.doc} */\nconst ${entry.name}: ${entry.signature};` : entry.declaration(false) } : {}) });
                continue;
            }
            const mapping = mappings.get(entry.path);
            const level = entry.fixLevel(mapping?.alwaysVisible);
            const description = mapping?.description ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
            if (level && (ptc || level === 1)) hints.push({ path: entry.path, description,
                ...(level === 2 ? { declaration: declaration({ ...entry, path: entry.path, doc: description }, false) } : {}) });
        }
        for (const item of state.namespaces ?? []) {
            const node = root.resolve(item.path.split('.'));
            if (item.alwaysVisible && node && !node.disabled) hints.push({ ...item, namespace: true });
        }
        for (const [path, pinned] of Object.entries(state.namespaceVisible ?? {})) {
            const node = root.resolve(path.split('.'));
            if (pinned && !registry.disabled(path) && node && node.permissions.availableFixLevels.length) hints.push({ path, namespace: true, description: node instanceof NamespaceNode ? node.description : node.doc });
        }
        const included = new Set(hints.map(hint => hint.path));
        for (const hint of [...hints]) {
            let parent = root.resolve(hint.path.split('.'))?.parent;
            while (parent?.path) {
                if (!included.has(parent.path)) {
                    hints.push({ path: parent.path, namespace: true, description: parent.description });
                    included.add(parent.path);
                }
                parent = parent.parent;
            }
        }
        const discoveryAvailable = root.commands().some(entry => !entry.disabled && registry.definitions.addition(entry.tool).discovery);
        return ptc ? namespaceDirectory(hints, discoveryAvailable) : nativeDirectory(hints, discoveryAvailable);
    }

    /** @brief Expose detailed pins and explicitly queried commands as native tools. */
    private nativeEntries(agent: Agent, registry: SemanticRegistry, entries: CommandNode[]): CommandNode[] {
        const state = registry.snapshot();
        const discovered = this.discovered.get(agent.id);
        const pinned = new Set(registry.effective().filter(mapping => mapping.alwaysVisible === 2).map(mapping => mapping.path));
        const available = new Set(entries.map(entry => entry.path));
        for (const path of discovered ?? []) if (!available.has(path)) discovered!.delete(path);
        return entries.filter(entry => entry.fixLevel(state.builtinVisible?.[entry.path] ?? entry.fixedLevel) === 2 || discovered?.has(entry.path)
            || pinned.has(entry.path)
        );
    }

    /** @brief Expand native tools for this conversation and invalidate the assembled system prompt. */
    async discover(agent: Agent, queries: readonly string[], root?: NamespaceNode): Promise<string> {
        const registry = await this.registryFor(agent);
        const profile = agent.session.intellisense?.profile;
        if (!profile) throw new Error('A session Profile is required');
        root ??= inspectionTree(profile, registry, this.isPtc(agent));
        const brief = (_tool: string, path: string): string | undefined => inspectionBrief(profile, path);
        if (this.isPtc(agent)) return nativeDiscovery(queries, root, brief);
        const selected = nativeQueryEntries(queries, root);
        let discovered = this.discovered.get(agent.id);
        if (!discovered) this.discovered.set(agent.id, discovered = new Set());
        for (const entry of selected) {
            discovered.delete(entry.path);
            discovered.add(entry.path);
        }
        while (discovered.size > 256) discovered.delete(discovered.values().next().value!);
        await this.syncNative(agent, registry);
        this.ctx.emit('system-prompt/change');
        return nativeDiscovery(queries, root, brief);
    }

    /** @brief Install scoped namespace aliases while keeping dispatch inside native guards and auditing. */
    async syncNative(agent: Agent, registry?: SemanticRegistry, root?: NamespaceNode): Promise<string[]> {
        registry ??= await this.registryFor(agent);
        const source = JSON.stringify([registry.generation, [...this.discovered.get(agent.id) ?? []]]);
        const previous = this.nativeTools.get(agent.id);
        if (previous?.source === source) return [...previous.names];
        const entries = (root ?? await this.tree(agent, registry)).commands().filter(entry => !entry.disabled);
        const visible = new Set(this.nativeEntries(agent, registry, entries));
        const bindings = nativeBindings(entries, registry.tools().map(tool => tool.id)).filter(({ entry }) => visible.has(entry));
        const descriptionFor = (entry: CommandNode): string => registry.description(entry.path, entry.tool) ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
        const fingerprint = JSON.stringify(bindings.map(({ entry, name }) => ({ name, path: entry.path, node: entry.serialize(), description: descriptionFor(entry) })));
        const names = bindings.map(binding => binding.name);
        if (previous?.fingerprint === fingerprint) {
            previous.source = source;
            previous.names = names;
            return [...names];
        }
        for (const dispose of previous?.disposers ?? []) dispose();
        const state = { source, names, fingerprint, disposers: [] as (() => void)[] };
        this.nativeTools.set(agent.id, state);
        for (const { entry, name } of bindings) {
            if (name === entry.tool) continue;
            const definition: ToolDefinition = {
                name, description: `${entry.path}: ${descriptionFor(entry)}`, parameters: entry.schema,
                output: { schema: entry.output ?? {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                execute: async (args, parent) => {
                    const caller = parent.agent;
                    if (!caller) throw new Error('A live conversation is required');
                    return await this.dispatch(caller, entry, entry.nativeArguments(args), parent, 1) ?? null;
                },
            };
            const physical = agent.ctx.tools.get?.(entry.tool, agent);
            if (physical?.presentCall) definition.presentCall = args => physical.presentCall!(entry.nativeArguments(args));
            if (physical?.presentResult) definition.presentResult = (args, result) => physical.presentResult!(entry.nativeArguments(args), result);
            this.generatedTools.add(definition);
            state.disposers.push(agent.ctx.tools.register(definition));
        }
        return [...names];
    }

    /** @brief Dispatch a namespace call through native permission checks and paired child audit records. */
    async dispatch(agent: Agent, entry: CommandNode, args: unknown, parent: ToolRunContext, sequence: number): Promise<unknown> {
        return entry.result(await this.dispatchTool(agent, entry.tool, args, parent, sequence));
    }

    /** @brief Dispatch a physical tool through DSH, which owns permission checks and execution. */
    async dispatchTool(agent: Agent, tool: string, args: unknown, parent: ToolRunContext, sequence: number): Promise<unknown> {
        const callId = ToolCallId(`${parent.callId}:tool:${sequence}`);
        const ids = { rootCallId: parent.rootCallId, parentCallId: parent.callId, subCallId: callId, name: tool, arguments: args };
        agent.session.append('tool/ptc-dispatch-start', ids);
        await (await this.profiles.addition(agent.session)).statistics.increment([tool]);
        const settled = await agent.ctx.tools.execute({ agent, callId, rootCallId: parent.rootCallId, parent: parent.token, name: tool, arguments: args, signal: parent.signal });
        agent.session.append('tool/ptc-dispatch', { ...ids, isError: settled.isError, content: settled.content, ...(settled.meta ? { meta: settled.meta } : {}) });
        for (const context of settled.additionalContexts ?? []) parent.deferContext(context);
        if (settled.concludesTurn) parent.concludeTurn();
        if (settled.isError) throw new Error(settled.error.message);
        return settled.value;
    }

    /** @brief Release scoped aliases and presentation caches. */
    async release(owner: string): Promise<void> {
        this.catalogRevision++;
        for (const dispose of this.nativeTools.get(owner)?.disposers ?? []) dispose();
        this.nativeTools.delete(owner);
        this.positions.delete(owner);
        this.discovered.delete(owner);
    }
}
