import type { ProfileSnapshot } from '../registry/profile/profile.js';
import { ProfileWriteSchema, validateProfilePatch, type ProfilePatch, type ProfileWrite } from '../registry/profile_write.js';
import { editedConfiguration } from '../registry/profile/configuration.js';
import { profileTree } from '../registry/profile_tree.js';
import type { ProfileSaveEvent } from '../namespace/service.js';
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
import { registerInspect } from '../tools/inspect.js';
import { registerToolCommands } from '../tools/tool_commands.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from '../namespace/native_tools.js';
import { CommandStatistics } from '../namespace/statistics.js';
import { ProfileNotFoundError } from '../error.js';

import { NamespaceComponent } from '../namespace/component.js';

/** @brief Own Agent session Profiles, discovery, presentation and native execution integration. */
export class AgentSessionAddition {
    private refreshedRevision = -1;
    private refreshing?: Promise<void>;
    private generatedTools = new WeakSet<ToolDefinition>();
    private physicalSources = new WeakMap<Agent, { registry: SemanticRegistry; tools: object; revision: number; chain: ScopeKey[] }>();
    private positions = new Map<string, Position>();
    private discovered = new Map<string, Set<string>>();
    private nativeTools = new Map<string, { source: string; names: string[]; fingerprint: string; disposers: (() => void)[] }>();

    constructor(private ctx: Context, readonly namespace: NamespaceComponent, readonly profiles: ProfileSessions) {
        namespace.refresh = () => this.refresh();
        ctx.effect(() => async () => { await Promise.all([...new Set([...this.nativeTools.keys(), ...this.positions.keys(), ...this.discovered.keys()])].map(id => this.release(id))); await this.profiles.dispose(); namespace.refresh = async () => {}; });
        ctx.on('agent/request', async (payload, next) => {
            if (this.enabled(payload.agent)) this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    private get registry(): SemanticRegistry { return this.namespace.registry; }
    private get aliases(): z.infer<typeof Aliases> { return this.namespace.aliases; }
    private get catalogRevision(): number { return this.namespace.catalogRevision; }
    private set catalogRevision(value: number) { this.namespace.catalogRevision = value; }
    get statistics(): CommandStatistics { return this.namespace.statistics; }
    get searchEngines() { return this.namespace.searchEngines; }

    /** @brief Save compares the target against the selected baseline and delegates actual mutations to node apply methods. */
    saveProfile(agent: Agent, name: string | undefined, value: ProfileWrite): Promise<string | null> {
        return this.writeProfile(agent, name, ProfileWriteSchema.parse(value), 'save');
    }

    /** @brief Apply is the primitive patch operation; reading and writing share one transaction. */
    applyProfile(agent: Agent, name: string | undefined, patch: ProfilePatch): Promise<string | null> {
        validateProfilePatch(patch as Record<string, unknown>);
        return this.writeProfile(agent, name, patch, 'apply');
    }

    /** @brief Node-owned processing completes before atomic persistence; basic events are emitted only after commit. */
    private async writeProfile(agent: Agent, name: string | undefined, input: ProfileWrite | ProfilePatch, operation: 'save' | 'apply'): Promise<string | null> {
        const saved = await this.namespace.profileTransaction(async () => {
            const session = await this.registryFor(agent);
            const target = name ?? session.profileSelection().selected;
            const catalog = this.registry;
            const revision = catalog.revision;
            if (operation === 'apply' && name !== undefined && !catalog.profileSelection().profiles.includes(target)) throw new ProfileNotFoundError(target);
            const original = catalog.profileSelection().profiles.includes(target) ? catalog.configuration(target) : session.configuration();
            const source = operation === 'apply' && name === undefined ? session.configuration() : original;
            const baseline = this.registry.definitions.profile(profileTree(target, original, catalog.definitions).save());
            const snapshot = this.registry.definitions.profile(profileTree(target, source, catalog.definitions).save());
            if (operation === 'save') snapshot.save(input as ProfileWrite);
            else snapshot.apply(input as ProfilePatch);
            snapshot.check({ commands: new Set((await this.commandBriefs(agent)).map(command => command.name)),
                addition: tool => catalog.definitions.addition(tool), original: baseline.serialize() });
            const information = snapshot.saveInformation(session.tools().map(tool => tool.id));
            const value = { name: target, brief: snapshot.brief, root: snapshot.serialize() };
            const configuration = editedConfiguration(value, original, catalog.definitions);
            await catalog.saveProfile(target, configuration, { trusted: true, revision });
            this.ctx.emit('system-prompt/change');
            const event: ProfileSaveEvent = Object.freeze({ name: target, time: new Date().toISOString(), type: operation });
            return { event, information };
        });
        const result = await this.registry.definitions.processSave(saved.event);
        return result === undefined ? saved.information : result;
    }

    /** @brief Read the current conversation snapshot. */
    async get(agent: Agent): Promise<ProfileSnapshot> {
        const registry = await this.registryFor(agent);
        return registry.definitions.profile(profileTree(registry.profileSelection().selected, registry.configuration(), registry.definitions).save());
    }

    /** @brief Publish a conversation edit without changing its catalog Profile. */
    edit(agent: Agent, modifier: (snapshot: ProfileSnapshot) => ProfileSnapshot): Promise<ProfileSnapshot> {
        return this.namespace.profileTransaction(async () => {
            const registry = await this.registryFor(agent);
            const revision = registry.revision;
            const output = modifier(await this.get(agent));
            if (!output || typeof output.serialize !== 'function') throw new Error('Profile modifier must return a snapshot');
            const published = registry.definitions.profile({ brief: output.brief, root: output.serialize() });
            const name = registry.profileSelection().selected;
            await registry.saveProfile(name, editedConfiguration({ name, brief: published.brief, root: published.serialize() }, registry.configuration(), registry.definitions), { trusted: true, revision });
            await this.configurationChanged(agent);
            return published;
        });
    }

    /** @brief Project command summaries for the current conversation. */
    async commandBriefs(agent?: Agent, current?: SemanticRegistry): Promise<CommandBrief[]> { return this.namespace.commandBriefs(current ?? (agent ? await this.registryFor(agent) : this.registry)); }

    /** @brief Read catalog names with the current conversation selection. */
    async profileNames(agent?: Agent, current?: SemanticRegistry): Promise<Profiles> { return this.namespace.profileNames(current ?? (agent ? await this.registryFor(agent) : this.registry)); }

    /** @brief Preload values from the conversation Profile and presentation. */
    async values(agent?: Agent, current?: SemanticRegistry): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>> { return this.namespace.values(current ?? (agent ? await this.registryFor(agent) : this.registry), agent && !this.isPtc(agent) ? 'native' : 'ptc'); }

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
        if (this.refreshedRevision === this.catalogRevision) return;
        const revision = this.catalogRevision;
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
        const registry = await this.profiles.forSession(agent.id, async () => {
            const parent = this.ctx.agents.list().find(candidate => candidate !== agent && this.ctx.agents.isOwnedBy(agent.id, candidate));
            return parent && this.enabled(parent) ? this.registryFor(parent) : this.registry;
        }, profile);
        if (profile !== undefined && registry.profileSelection().selected !== profile) await this.profiles.load(agent.id, profile);
        const chain = scopeChainOf(agent);
        const tools: object = Reflect.get(agent.ctx.tools, symbols.original) ?? agent.ctx.tools;
        const previous = this.physicalSources.get(agent);
        if (!previous || previous.registry !== registry || previous.tools !== tools || previous.revision !== this.catalogRevision
            || previous.chain.length !== chain.length || previous.chain.some((scope, index) => scope !== chain[index])) {
            registry.refresh(this.physical(agent));
            this.physicalSources.set(agent, { registry, tools, revision: this.catalogRevision, chain });
        }
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async tree(agent: Agent, current?: SemanticRegistry): Promise<NamespaceNode> { return manifest(current ?? await this.registryFor(agent), this.aliases, this.isPtc(agent) ? 'ptc' : 'native'); }

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
        const root = manifest(registry, this.aliases, this.isPtc(agent) ? 'ptc' : 'native');
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
    async discover(agent: Agent, queries: readonly string[]): Promise<string> {
        const registry = await this.registryFor(agent);
        const root = manifest(registry, this.aliases, this.isPtc(agent) ? 'ptc' : 'native');
        if (this.isPtc(agent)) return nativeDiscovery(queries, root, (tool, path) => registry.description(path, tool));
        const selected = nativeQueryEntries(queries, root);
        let discovered = this.discovered.get(agent.id);
        if (!discovered) this.discovered.set(agent.id, discovered = new Set());
        for (const entry of selected) {
            discovered.delete(entry.path);
            discovered.add(entry.path);
        }
        while (discovered.size > 256) discovered.delete(discovered.values().next().value!);
        await this.syncNative(agent, registry, root);
        this.ctx.emit('system-prompt/change');
        return nativeDiscovery(queries, root, (tool, path) => registry.description(path, tool));
    }

    /** @brief Install scoped namespace aliases while keeping dispatch inside native guards and auditing. */
    async syncNative(agent: Agent, registry?: SemanticRegistry, root?: NamespaceNode): Promise<string[]> {
        registry ??= await this.registryFor(agent);
        const source = JSON.stringify([registry.generation, [...this.discovered.get(agent.id) ?? []]]);
        const previous = this.nativeTools.get(agent.id);
        if (previous?.source === source) return [...previous.names];
        const entries = (root ?? manifest(registry, this.aliases, this.isPtc(agent) ? 'ptc' : 'native')).commands().filter(entry => !entry.disabled);
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
        await this.statistics.recordCall(agent.id, tool);
        const settled = await agent.ctx.tools.execute({ agent, callId, rootCallId: parent.rootCallId, parent: parent.token, name: tool, arguments: args, signal: parent.signal });
        agent.session.append('tool/ptc-dispatch', { ...ids, isError: settled.isError, content: settled.content, ...(settled.meta ? { meta: settled.meta } : {}) });
        for (const context of settled.additionalContexts ?? []) parent.deferContext(context);
        if (settled.concludesTurn) parent.concludeTurn();
        if (settled.isError) throw new Error(settled.error.message);
        return settled.value;
    }

    /** @brief Release scoped aliases and the live Profile reference. */
    async release(owner: string): Promise<void> {
        this.catalogRevision++;
        for (const dispose of this.nativeTools.get(owner)?.disposers ?? []) dispose();
        this.nativeTools.delete(owner);
        this.positions.delete(owner);
        this.discovered.delete(owner);
        await this.profiles.release(owner);
    }
}
