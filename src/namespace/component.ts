import { outputSchema } from '../output_schema.js';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import * as presentation from '../integration/presentation.js';
import type { Position } from '../protocol/events.js';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
import '@deepseek-ai/dsh-agent-preset-registry';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { declaration, manifest, type Aliases, NamespaceNode, type CommandNode } from './namespace.js';
import { namespaceDirectory, type NamespaceHint } from './prompt.js';
import { pluginCommands, reservedToolIds } from '../runtime/builtins.js';
import { type CommandBrief, type Profiles, profileAnnotation } from '../registry/profile_tree.js';
import type { z } from 'zod';
import { createSearchEngines } from '../search/search.js';
import { registerSearch } from '../tools/tool_search.js';
import { registerIntellisense } from '../tools/intellisense.js';
import { registerToolCommands } from '../tools/tool_commands.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from './native_tools.js';
import { CommandStatistics } from './statistics.js';
import { MemoryStore } from '../storage/store.js';

/** @brief Profile-backed namespace discovery, independent of any execution runtime. */
export class NamespaceComponent {
    private catalogRevision = 0;
    private refreshedRevision = -1;
    private refreshing?: Promise<void>;
    private generatedTools = new WeakSet<ToolDefinition>();
    private positions = new Map<string, Position>();
    private discovered = new Map<string, Set<string>>();
    private nativeTools = new Map<string, { fingerprint: string; disposers: (() => void)[] }>();

    constructor(private ctx: Context, private registry: SemanticRegistry, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases>, readonly searchEngines = createSearchEngines(), readonly statistics = new CommandStatistics(new MemoryStore())) {
        ctx.effect(() => async () => { await Promise.all([...new Set([...this.nativeTools.keys(), ...this.positions.keys(), ...this.discovered.keys()])].map(id => this.release(id))); await this.profiles.dispose(); });
        ctx.on('tools/change', () => { this.catalogRevision++; });
        ctx.on('agent/request', async (payload, next) => {
            if (this.enabled(payload.agent)) this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    /** @brief Register builtin tools in the owning presentation scope. */
    register(ctx: Context): void {
        registerIntellisense(ctx, this);
        registerSearch(ctx, this);
        registerToolCommands(ctx, this.registry, this.profiles, agent => this.registryFor(agent), agent => this.configurationChanged(agent), agent => this.commandBriefs(agent));
    }

    /** @brief Enable namespaces only for an explicitly configured Intellisense scope. */
    enabled(agent: Agent): boolean { return presentation.presentationFor(agent.ctx) !== undefined; }

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
            if (reservedToolIds.includes(tool.name)) return [];
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
        const registry = await this.profiles.forSession(agent.id, async () => {
            const parent = this.ctx.agents.list().find(candidate => candidate !== agent && this.ctx.agents.isOwnedBy(agent.id, candidate));
            return parent && this.enabled(parent) ? this.registryFor(parent) : this.registry;
        });
        registry.refresh(this.physical(agent));
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async tree(agent: Agent): Promise<NamespaceNode> { return manifest(await this.registryFor(agent), this.aliases); }

    /** @brief Flatten command bindings only for consumers that dispatch physical tools. */
    async entries(agent: Agent): Promise<CommandNode[]> { return (await this.tree(agent)).commands().filter(entry => entry.deployment === 'tool'); }

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
        const { callsByTool } = await this.statistics.snapshot();
        return this.registry.tools().filter(tool => !reservedToolIds.includes(tool.id) && !pluginCommands.find(tool.id)).map(tool => ({
            name: tool.id, brief: tool.description, paths: paths.get(tool.id) ?? [], totalCalls: Object.hasOwn(callsByTool, tool.id) ? callsByTool[tool.id]! : 0,
        }));
    }

    /** @brief Read catalog names separately from the conversation's selected Profile. */
    async profileNames(agent?: Agent, current?: SemanticRegistry): Promise<Profiles> {
        const registry = current ?? (agent ? await this.registryFor(agent) : this.registry);
        return { profiles: this.registry.snapshot().profiles ?? [], selected: registry.snapshot().profile! };
    }

    /** @brief Preload data-only Profile metadata before guest execution. */
    async values(agent?: Agent): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>> {
        const registry = agent ? await this.registryFor(agent) : this.registry;
        const values = { 'tools.profile.annotation': profileAnnotation, 'tools.profile.commands': await this.commandBriefs(agent, registry), 'tools.profile.profiles': await this.profileNames(agent, registry) };
        return Object.fromEntries(Object.entries(values).filter(([path]) => !registry.disabled(path)));
    }

    /** @brief Refresh tool presentation after the conversation configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> {
        if (!this.isPtc(agent)) await this.syncNative(agent);
        this.ctx.emit('system-prompt/change');
    }

    /** @brief Publish only explicitly pinned commands and namespaces with their Profile briefs. */
    async prompt(agent: Agent): Promise<string> {
        if (!this.isPtc(agent)) return '';
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        const root = manifest(registry, this.aliases);
        const hints: NamespaceHint[] = [];
        const mappings = new Map(registry.effective().map(mapping => [mapping.path, mapping]));
        for (const entry of root.commands()) {
            if (!entry.permissions.renamable) {
                const level = entry.fixLevel((state.builtinVisible ?? pluginCommands.defaultBuiltinVisible)[entry.path] ?? 0);
                if (level) hints.push({ path: entry.path, description: entry.doc,
                    ...(level === 2 ? { declaration: entry.preload ? `/** @brief ${entry.doc} */\nconst ${entry.name}: ${entry.signature};` : entry.declaration(false) } : {}) });
                continue;
            }
            const mapping = mappings.get(entry.path);
            const level = entry.fixLevel(mapping?.alwaysVisible);
            const description = mapping?.description ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
            if (level) hints.push({ path: entry.path, description,
                ...(level === 2 ? { declaration: declaration({ ...entry, path: entry.path, doc: description }, false) } : {}) });
        }
        for (const item of state.namespaces ?? []) {
            const node = root.resolve(item.path.split('.'));
            if (item.alwaysVisible && node) hints.push({ ...item, namespace: true });
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
        return namespaceDirectory(hints);
    }

    /** @brief Keep native exposure limited to discovery, pinned commands and explicitly queried functions. */
    private nativeEntries(agent: Agent, registry: SemanticRegistry, entries: CommandNode[]): CommandNode[] {
        const state = registry.snapshot();
        const discovered = this.discovered.get(agent.id);
        const pinned = new Set(registry.effective().filter(mapping => mapping.alwaysVisible).map(mapping => mapping.path));
        const available = new Set(entries.map(entry => entry.path));
        for (const path of discovered ?? []) if (!available.has(path)) discovered!.delete(path);
        return entries.filter(entry => !entry.permissions.disableable || discovered?.has(entry.path)
            || pinned.has(entry.path)
            || state.builtinVisible?.[entry.path]);
    }

    /** @brief Expand native tools for this conversation and invalidate the assembled system prompt. */
    async discover(agent: Agent, queries: readonly string[]): Promise<string> {
        const registry = await this.registryFor(agent);
        const root = manifest(registry, this.aliases);
        const entries = root.commands().filter(entry => entry.deployment === 'tool');
        if (this.isPtc(agent)) return nativeDiscovery(queries, root, nativeBindings(entries, this.physical(agent).map(tool => tool.id)), (tool, path) => registry.description(path, tool));
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
        return nativeDiscovery(queries, root, nativeBindings(entries, this.physical(agent).map(tool => tool.id)), (tool, path) => registry.description(path, tool));
    }

    /** @brief Install scoped namespace aliases while keeping dispatch inside native guards and auditing. */
    async syncNative(agent: Agent, registry?: SemanticRegistry, root?: NamespaceNode): Promise<string[]> {
        registry ??= await this.registryFor(agent);
        const entries = (root ?? manifest(registry, this.aliases)).commands().filter(entry => entry.deployment === 'tool');
        const visible = new Set(this.nativeEntries(agent, registry, entries));
        const bindings = nativeBindings(entries, registry.tools().map(tool => tool.id)).filter(({ entry }) => visible.has(entry));
        const descriptionFor = (entry: CommandNode): string => registry.description(entry.path, entry.tool) ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
        const fingerprint = JSON.stringify(bindings.map(({ entry, name }) => ({ name, path: entry.path, node: entry.serialize(), description: descriptionFor(entry) })));
        const previous = this.nativeTools.get(agent.id);
        if (previous?.fingerprint === fingerprint) return bindings.map(binding => binding.name);
        for (const dispose of previous?.disposers ?? []) dispose();
        const state = { fingerprint, disposers: [] as (() => void)[] };
        this.nativeTools.set(agent.id, state);
        for (const { entry, name } of bindings) {
            if (name === entry.tool) continue;
            const definition: ToolDefinition = {
                name, description: `${entry.path}: ${descriptionFor(entry)}`, parameters: entry.schema,
                output: { schema: entry.tool === 'tools_intellisense' ? entry.output ?? {} : {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                execute: async (args, parent) => {
                    const caller = parent.agent;
                    if (!caller) throw new Error('A live conversation is required');
                    return await this.dispatch(caller, entry, entry.nativeArguments(args), parent, 1) ?? null;
                },
            };
            if (entry.tool === 'tools_intellisense') {
                const physical = agent.ctx.tools.get(entry.tool, agent)!;
                definition.presentCall = args => physical.presentCall?.(entry.nativeArguments(args));
                definition.presentResult = (args, result) => physical.presentResult?.(entry.nativeArguments(args), result);
            }
            this.generatedTools.add(definition);
            state.disposers.push(agent.ctx.tools.register(definition));
        }
        return bindings.map(binding => binding.name);
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
