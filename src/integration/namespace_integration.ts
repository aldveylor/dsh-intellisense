import type { Intellisense } from './intellisense.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import { outputSchema } from '../output_schema.js';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import * as presentation from '../integration/presentation.js';
import type { Position } from '../protocol/events.js';
import { type Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ScopeKey } from '@deepseek-ai/dsh-scope';
import '@deepseek-ai/dsh-agent-preset-registry';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { declaration, commandEntries, profileMembers, queryNodes, normalizeInspectQueries, nativeArgumentsFor, resultFor, type Aliases, type CommandEntry } from '../namespace/namespace.js';
import type { AgentSessionAddition } from './agent_session_addition.js';
import type { ProfileCommand } from '../registry/profile/command.js';
import type { ProfileNamespace } from '../registry/profile/namespace.js';
import { inspect } from '../tools/inspect.js';
import { namespaceDirectory, nativeDirectory, type NamespaceHint } from '../namespace/prompt.js';

import { type CommandBrief, type Profiles } from '../registry/profile_tree.js';
import type { z } from 'zod';
import { registerSearch } from '../tools/tool_search.js';
import { registerInspect } from '../tools/inspect.js';
import { registerToolCommands } from '../tools/tool_commands.js';
import { nativeBindings, nativeDiscovery } from '../namespace/native_tools.js';

import { createSearchEngines } from '../search/search.js';
import { NamespaceComponent } from '../namespace/component.js';

/** @brief Own Agent session Profiles, discovery, presentation and native execution integration. */
export class NamespaceIntegration {
    readonly intellisense: Intellisense;

    private refreshedRevision = '';
    private refreshing?: Promise<void>;
    private generatedTools = new WeakSet<ToolDefinition>();
    private positions = new Map<string, Position>();
    private discovered = new Map<string, Set<string>>();
    private nativeTools = new Map<string, { source: string; names: string[]; fingerprint: string; disposers: (() => void)[] }>();

    private catalogRevision = 0;
    private get catalogVersion(): string { return `${this.catalogRevision}:${this.registry.definitions.revision}:${this.registry.toolAdditions.revision}`; }

    constructor(private ctx: Context, readonly namespace: NamespaceComponent, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases> = [], readonly searchEngines = createSearchEngines(), readonly statistics = profiles.statistics, readonly inspectStatistics = profiles.inspectStatistics) {
        this.intellisense = { profiles: namespace, toolAdditions: this.registry.toolAdditions, statistics, inspectStatistics, searchEngines };
        ctx.effect(() => async () => { await Promise.all([...new Set([...this.nativeTools.keys(), ...this.positions.keys(), ...this.discovered.keys()])].map(id => this.release(id))); await this.statistics.dispose(); await this.inspectStatistics.dispose(); });
        ctx.on('tools/change', () => { this.catalogRevision++; });
        ctx.on('agent/request', async (payload, next) => {
            if (this.enabled(payload.agent)) this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    private get registry(): SemanticRegistry { return this.namespace.registry; }

    /** @brief Initialize the session reference, inheriting the parent's exact immutable version. */
    async addition(agent: Agent): Promise<AgentSessionAddition> {
        const fixed = this.fixedProfile(agent);
        const addition = await this.profiles.addition(agent.session, async () => {
            const parent = this.ctx.agents.list().find(candidate => candidate !== agent && this.ctx.agents.isOwnedBy(agent.id, candidate));
            return parent && this.enabled(parent) ? this.addition(parent) : undefined;
        }, fixed);
        if (fixed !== undefined && addition.name !== fixed) return this.profiles.load(agent.session, fixed);
        return addition;
    }

    /** @brief Read an editing value from the current immutable reference. */
    async get(agent: Agent): Promise<ProfileSnapshot> { return (await this.addition(agent)).profile.snapshot; }

    /** @brief List physical commands and their paths from the original session nodes, including disabled mounts. */
    async commandBriefs(agent?: Agent): Promise<CommandBrief[]> {
        await this.refresh();
        const profile = agent ? await this.get(agent) : (await this.registry.reference()).snapshot;
        const paths = new Map<string, string[]>();
        for (const { path, node } of profileMembers(profile, false)) {
            if (node.type !== 'command') continue;
            const tool = (node as ProfileCommand).tool!;
            if (!paths.has(tool)) paths.set(tool, []);
            paths.get(tool)!.push(path);
        }
        const callsByTool = await this.statistics.calls.snapshot();
        return this.registry.tools().filter(tool => !this.registry.toolAdditions.get(tool.id).hidden && !this.registry.owns(tool.id)).map(tool => ({
            name: tool.id, brief: tool.description, paths: paths.get(tool.id) ?? [], totalCalls: Object.hasOwn(callsByTool, tool.id) ? callsByTool[tool.id]! : 0,
        }));
    }

    /** @brief Read catalog names independently from a session's selected name and old version. */
    async profileNames(agent?: Agent): Promise<Profiles> {
        return { profiles: this.registry.profileSelection().profiles, selected: agent ? (await this.addition(agent)).name : this.registry.profileSelection().selected };
    }

    /** @brief Ask concrete commands for enabled preloaded values. */
    async values(agent: Agent, entries?: CommandEntry[]): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>> {
        const values: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
        for (const entry of entries ?? await this.entries(agent)) {
            if (entry.preload && entry.node.readValue) values[entry.path] = await entry.node.readValue({ commandBriefs: () => this.commandBriefs(agent), profileNames: () => this.profileNames(agent) }) as z.infer<ReturnType<typeof z.json>>;
        }
        return values;
    }

    /** @brief Register builtin tools in the owning presentation scope. */
    register(ctx: Context): void {
        registerInspect(ctx, this);
        registerSearch(ctx, this);
        registerToolCommands(ctx, this.registry, this.profiles, agent => this.configurationChanged(agent), agent => this.commandBriefs(agent), this);
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
        else await this.addition(agent);
    }

    /** @brief Read the native loop position for ordinary tool query audit events. */
    position(agent: Agent): Position { return this.positions.get(agent.id) ?? { turn: 0, step: 0 }; }

    /** @brief Read only the native tool catalog visible to this agent. */
    physical(agent?: Agent, scope: ScopeKey | undefined = agent): PhysicalTool[] {
        const tools = agent?.ctx.tools ?? this.ctx.tools;
        return tools.schemas(scope).flatMap(tool => {
            if (this.registry.toolAdditions.get(tool.name).hidden) return [];
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

    /** @brief Derive flat physical contracts while retaining references to the original Profile commands. */
    async entries(agent: Agent, profile?: ProfileSnapshot): Promise<CommandEntry[]> {
        return commandEntries(profile ?? await this.get(agent), this.physical(agent), this.isPtc(agent) ? 'ptc' : 'native', this.intellisense.toolAdditions);
    }

    /** @brief Refresh tool presentation after the conversation configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> {
        if (!this.isPtc(agent)) await this.syncNative(agent);
        this.ctx.emit('system-prompt/change');
    }

    /** @brief Render pinned original nodes directly, deriving only output declarations. */
    async prompt(agent: Agent): Promise<string> {
        const ptc = this.isPtc(agent);
        const profile = await this.get(agent);
        const entries = await this.entries(agent, profile);
        const hints = new Map<string, NamespaceHint>();
        for (const entry of entries) {
            const level = entry.fixedLevel;
            const description = entry.provided ? entry.doc : entry.node.serialize().command.doc ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
            if (level && (ptc || level === 1)) hints.set(entry.path, { path: entry.path, description,
                ...(level === 2 ? { declaration: entry.preload ? `/** @brief ${description} */\nconst ${entry.name}: ${entry.signature};` : declaration({ ...entry, doc: description }, false) } : {}) });
        }
        for (const { path, node } of profileMembers(profile)) {
            if (node.type === 'namespace' && node.serialize().fixedLevel) hints.set(path, { path, namespace: true, description: node.serialize().description });
        }
        for (const path of [...hints.keys()]) {
            const parts = path.split('.');
            while (parts.length > 1) {
                parts.pop();
                const parent = parts.join('.');
                if (!hints.has(parent)) hints.set(parent, { path: parent, namespace: true, description: profile.resolve(parent)?.serialize().description });
            }
        }
        const discovery = entries.some(entry => entry.node.discovery);
        return ptc ? namespaceDirectory([...hints.values()], discovery) : nativeDirectory([...hints.values()], discovery);
    }

    /** @brief Resolve discovery from the session snapshot and supplement only the selected command contracts. */
    async discover(agent: Agent, queries: readonly string[]): Promise<string> {
        const profile = await this.get(agent);
        const entries = await this.entries(agent, profile);
        if (this.isPtc(agent)) return inspect(queries, profile, entries, true);
        const exact = new Set(normalizeInspectQueries(queries));
        const available = new Set(entries.map(entry => entry.path));
        let discovered = this.discovered.get(agent.id);
        if (!discovered) this.discovered.set(agent.id, discovered = new Set());
        for (const { path, node } of queryNodes(profile, queries)) {
            if (node.type !== 'command' || !exact.has(path) || !available.has(path)) continue;
            discovered.delete(path);
            discovered.add(path);
        }
        while (discovered.size > 256) discovered.delete(discovered.values().next().value!);
        await this.syncNative(agent, entries);
        this.ctx.emit('system-prompt/change');
        return nativeDiscovery(queries, profile, entries);
    }

    /** @brief Register native tools from flat contracts without constructing another node hierarchy. */
    async syncNative(agent: Agent, current?: CommandEntry[]): Promise<string[]> {
        const addition = await this.addition(agent);
        const entries = current ?? await this.entries(agent);
        const discovered = this.discovered.get(agent.id);
        const available = new Set(entries.map(entry => entry.path));
        for (const path of discovered ?? []) if (!available.has(path)) discovered!.delete(path);
        const bindings = nativeBindings(entries, this.physical(agent).map(tool => tool.id)).filter(({ entry }) => entry.fixedLevel === 2 || discovered?.has(entry.path));
        const descriptionFor = (entry: CommandEntry): string => entry.node.serialize().command.doc ?? entry.doc.trim().split(/\r?\n/, 1)[0]!;
        const fingerprint = JSON.stringify([addition.profile.pointer, bindings.map(({ entry, name }) => ({ name, path: entry.path, doc: entry.doc, schema: entry.schema, output: entry.output, description: descriptionFor(entry) }))]);
        const previous = this.nativeTools.get(agent.id);
        const names = bindings.map(binding => binding.name);
        if (previous?.fingerprint === fingerprint) return [...names];
        for (const dispose of previous?.disposers ?? []) dispose();
        const state = { source: '', names, fingerprint, disposers: [] as (() => void)[] };
        this.nativeTools.set(agent.id, state);
        for (const { entry, name } of bindings) {
            if (name === entry.tool) continue;
            const definition: ToolDefinition = {
                name, description: `${entry.path}: ${descriptionFor(entry)}`, parameters: entry.schema,
                output: { schema: entry.output ?? {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                execute: async (args, parent) => {
                    const caller = parent.agent;
                    if (!caller) throw new Error('A live conversation is required');
                    return await this.dispatch(caller, entry, nativeArgumentsFor(entry, args), parent, 1) ?? null;
                },
            };
            const physical = agent.ctx.tools.get?.(entry.tool, agent);
            if (physical?.presentCall) definition.presentCall = args => physical.presentCall!(nativeArgumentsFor(entry, args));
            if (physical?.presentResult) definition.presentResult = (args, result) => physical.presentResult!(nativeArgumentsFor(entry, args), result);
            this.generatedTools.add(definition);
            state.disposers.push(agent.ctx.tools.register(definition));
        }
        return [...names];
    }

    /** @brief Dispatch a namespace call through native permission checks and paired child audit records. */
    async dispatch(agent: Agent, entry: CommandEntry, args: unknown, parent: ToolRunContext, sequence: number): Promise<unknown> {
        const value = await this.dispatchTool(agent, entry.tool, args, parent, sequence);
        return entry.presentation?.discardResult ? undefined : resultFor(entry, value);
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
