import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import * as presentation from './presentation.js';
import type { Position } from '../protocol/events.js';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
import '@deepseek-ai/dsh-agent-preset-registry';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { declaration, manifest, nativeArgumentsFor, nativeSchema, resultFor, type Aliases, type ManifestEntry } from './namespace.js';
import { builtinDeclaration, namespaceDirectory, type NamespaceHint } from './prompt.js';
import { builtinCommands, defaultBuiltinVisible, discoveryCommand, profileValues } from '../runtime/builtins.js';
import { profileAnnotation } from '../registry/profile_tree.js';
import type { z } from 'zod';
import { registerIntellisense } from './intellisense.js';
import { registerToolCommands } from './tool_commands.js';
import { nativeBindings, nativeDiscovery, nativeQueryEntries } from './native_tools.js';

/** @brief Profile-backed namespace discovery, independent of any execution runtime. */
export class NamespaceComponent {
    private generatedTools = new WeakSet<ToolDefinition>();
    private positions = new Map<string, Position>();
    private discovered = new Map<string, Set<string>>();
    private nativeTools = new Map<string, { fingerprint: string; disposers: (() => void)[] }>();

    constructor(private ctx: Context, private registry: SemanticRegistry, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases>, _defaultMode: presentation.PresentationMode = 'native') {
        ctx.effect(() => async () => { await Promise.all([...this.nativeTools.keys()].map(id => this.release(id))); });
        ctx.on('agent/request', async (payload, next) => {
            if (this.enabled(payload.agent)) this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    /** @brief Register builtin tools in the owning presentation scope. */
    register(ctx: Context): void {
        registerIntellisense(ctx, this);
        registerToolCommands(ctx, this.registry, this.profiles, agent => this.registryFor(agent), agent => this.configurationChanged(agent));
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
        await this.registryFor(agent);
        if (!this.isPtc(agent)) await this.syncNative(agent);
    }

    /** @brief Read the native loop position for ordinary tool query audit events. */
    position(agent: Agent): Position { return this.positions.get(agent.id) ?? { turn: 0, step: 0 }; }

    /** @brief Read only the native tool catalog visible to this agent. */
    physical(agent?: Agent, scope: ScopeKey | undefined = agent): PhysicalTool[] {
        const tools = agent?.ctx.tools ?? this.ctx.tools;
        return tools.schemas(scope).filter(tool => !['exec', 'run_code'].includes(tool.name) && !this.generatedTools.has(tools.get(tool.name, scope)!)).map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tools.get(tool.name, scope)!.output.schema }));
    }

    /** @brief Include standing preset tools in the editor catalog even without live conversations. */
    async refresh(): Promise<void> {
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

    /** @brief Resolve the session's immutable Profile reference against its current tool scope. */
    async registryFor(agent?: Agent): Promise<SemanticRegistry> {
        if (!agent) { await this.refresh(); return this.registry; }
        const registry = await this.profiles.forSession(agent.id);
        registry.refresh(this.physical(agent));
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async entries(agent: Agent): Promise<ManifestEntry[]> { return manifest(await this.registryFor(agent), this.aliases); }

    /** @brief Preload data-only Profile metadata before guest execution. */
    async values(agent: Agent): Promise<{ [path: string]: string | { name: string; brief: string }[] }> {
        return { 'tools.profile.annotation': profileAnnotation, 'tools.profile.commands': (await this.registryFor(agent)).tools().filter(tool => !tool.id.startsWith('tools_')).map(tool => ({ name: tool.id, brief: tool.description })) };
    }

    /** @brief Notify the native system-prompt assembler after session configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> { await this.registryFor(agent); if (!this.isPtc(agent)) await this.syncNative(agent); this.ctx.emit('system-prompt/change'); }

    /** @brief Publish only explicitly pinned commands and namespaces with their Profile briefs. */
    async prompt(agent: Agent): Promise<string> {
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        if (!this.isPtc(agent)) {
            const entries = manifest(registry, this.aliases);
            const bindings = nativeBindings(entries, registry.tools().map(tool => tool.id));
            const visible = new Set((await this.nativeEntries(agent)).map(entry => entry.path));
            return JSON.stringify({
                namespaces: [...new Set(entries.filter(entry => !visible.has(entry.path)).map(entry => entry.path.split('.')[0]!))].sort(),
                tools: bindings.filter(({ entry }) => visible.has(entry.path)).map(({ entry, name }) => ({ path: entry.path, tool: name, description: entry.doc })),
            }, null, 2);
        }
        const entries = manifest(registry, this.aliases).filter(entry => !['tools_profile_annotation', 'tools_profile_commands'].includes(entry.tool));
        const hints: NamespaceHint[] = [];
        for (const entry of entries) {
            const mapping = registry.effective().find(mapping => mapping.id === entry.tool);
            if (mapping?.alwaysVisible) hints.push({ path: entry.path, description: state.toolComments?.[entry.tool] ?? mapping.description ?? entry.doc,
                ...(mapping.alwaysVisible === 2 ? { declaration: declaration(entry, false) } : {}) });
        }
        for (const item of state.namespaces ?? []) if (item.alwaysVisible && entries.some(entry => entry.path.startsWith(item.path + '.'))) hints.push({ ...item, namespace: true });
        if (this.isPtc(agent) && state.consolePinned) hints.push({ path: 'console', description: 'Native console output', namespace: true });
        for (const item of (this.isPtc(agent) ? builtinCommands : builtinCommands.filter(command => command.path.startsWith('tools.')))) {
            const level = item.path === discoveryCommand.path ? 2 : (state.builtinVisible ?? defaultBuiltinVisible)[item.path] ?? 0;
            if (level) hints.push({ ...item, ...(level === 2 ? { declaration: builtinDeclaration(item) } : {}) });
        }
        for (const item of profileValues) {
            const level = state.builtinVisible?.[item.path] ?? 0;
            if (level) hints.push({ ...item, ...(level === 2 ? { declaration: this.isPtc(agent) ? `const ${item.path.split('.').at(-1)}: ${item.signature};` : `function ${item.path.split('.').at(-1)}(): Promise<${item.signature}>;` } : {}) });
        }
        return (hints.some(item => item.declaration && item.path.startsWith('tools.profile.')) ? '```ts\n' + profileAnnotation + '\n```\n\n' : '') + namespaceDirectory(hints);
    }

    /** @brief Keep native exposure limited to discovery, pinned commands and queried members. */
    private async nativeEntries(agent: Agent): Promise<ManifestEntry[]> {
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        const discovered = this.discovered.get(agent.id);
        return manifest(registry, this.aliases).filter(entry => entry.path === discoveryCommand.path || discovered?.has(entry.path)
            || registry.effective().some(mapping => mapping.id === entry.tool && mapping.alwaysVisible)
            || state.builtinVisible?.[entry.path]);
    }

    /** @brief Expand native tools for this conversation and invalidate the assembled system prompt. */
    async discover(agent: Agent, queries: readonly string[]): Promise<string> {
        const entries = await this.entries(agent);
        const selected = nativeQueryEntries(queries, entries);
        let discovered = this.discovered.get(agent.id);
        if (!discovered) this.discovered.set(agent.id, discovered = new Set());
        for (const entry of selected) discovered.add(entry.path);
        await this.syncNative(agent);
        this.ctx.emit('system-prompt/change');
        return nativeDiscovery(queries, nativeBindings(entries, this.physical(agent).map(tool => tool.id)));
    }

    /** @brief Install scoped namespace aliases while keeping dispatch inside native guards and auditing. */
    async syncNative(agent: Agent): Promise<string[]> {
        const entries = await this.entries(agent);
        const visible = new Set((await this.nativeEntries(agent)).map(entry => entry.path));
        const bindings = nativeBindings(entries, this.physical(agent).map(tool => tool.id)).filter(({ entry }) => visible.has(entry.path));
        const fingerprint = JSON.stringify(bindings);
        const previous = this.nativeTools.get(agent.id);
        if (previous?.fingerprint === fingerprint) return bindings.map(binding => binding.name);
        for (const dispose of previous?.disposers ?? []) dispose();
        const state = { fingerprint, disposers: [] as (() => void)[] };
        this.nativeTools.set(agent.id, state);
        for (const { entry, name } of bindings) {
            if (name === entry.tool && !entry.argMap) continue;
            const definition: ToolDefinition = {
                name, description: `${entry.path}: ${entry.doc}`, parameters: nativeSchema(entry),
                output: { schema: {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                execute: async (args, parent) => {
                    const caller = parent.agent;
                    if (!caller) throw new Error('A live conversation is required');
                    const current = (await this.entries(caller)).find(candidate => candidate.path === entry.path && candidate.tool === entry.tool);
                    if (!current) throw new Error(`Execution denied: ${entry.path}`);
                    return this.dispatch(caller, current, nativeArgumentsFor(current, args), parent, 1);
                },
            };
            this.generatedTools.add(definition);
            state.disposers.push(agent.ctx.tools.register(definition));
        }
        return bindings.map(binding => binding.name);
    }

    /** @brief Dispatch a namespace call through native permission checks and paired child audit records. */
    async dispatch(agent: Agent, entry: ManifestEntry, args: unknown, parent: ToolRunContext, sequence: number): Promise<unknown> {
        if (!agent.ctx.tools.get(entry.tool, agent)) throw new Error(`Execution denied: ${entry.path}`);
        const callId = ToolCallId(`${parent.callId}:tool:${sequence}`);
        const ids = { rootCallId: parent.rootCallId, parentCallId: parent.callId, subCallId: callId, name: entry.tool, arguments: args };
        agent.session.append('tool/ptc-dispatch-start', ids);
        const settled = await agent.ctx.tools.execute({ agent, callId, rootCallId: parent.rootCallId, parent: parent.token, name: entry.tool, arguments: args, signal: parent.signal });
        agent.session.append('tool/ptc-dispatch', { ...ids, isError: settled.isError, content: settled.content, ...(settled.meta ? { meta: settled.meta } : {}) });
        for (const context of settled.additionalContexts ?? []) parent.deferContext(context);
        if (settled.concludesTurn) parent.concludeTurn();
        if (settled.isError) throw new Error(settled.error.message);
        return resultFor(entry, settled.value) ?? null;
    }

    /** @brief Release scoped aliases and the live Profile reference. */
    async release(owner: string): Promise<void> {
        for (const dispose of this.nativeTools.get(owner)?.disposers ?? []) dispose();
        this.nativeTools.delete(owner);
        this.positions.delete(owner);
        this.discovered.delete(owner);
        this.profiles.release(owner);
    }
}
