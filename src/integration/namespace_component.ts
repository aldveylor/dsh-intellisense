import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-agent-preset-registry';
import type { Position } from '../protocol/events.js';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { manifest, nativeArgumentsFor, nativeSchema, resultFor, type Aliases, type ManifestEntry } from './namespace.js';
import { namespaceDirectory, type NamespaceHint } from './prompt.js';
import { builtinCommands, defaultBuiltinVisible, discoveryCommand } from '../runtime/builtins.js';
import type { z } from 'zod';

/** @brief Profile-backed namespace discovery, independent of any execution runtime. */
export class NamespaceComponent {
    private positions = new Map<string, Position>();
    private nativeTools = new Map<string, { fingerprint: string; names: Set<string>; disposers: (() => void)[] }>();

    constructor(private ctx: Context, private registry: SemanticRegistry, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases>) {
        ctx.on('agent/request', async (payload, next) => {
            this.positions.set(payload.agent.id, { turn: payload.turn, step: payload.step });
            return next();
        });
    }

    /** @brief Resolve the actual live preset so native sessions never enter the PTC runtime. */
    isPtc(agent: Agent): boolean {
        const preset = this.ctx.get('agentPresets')?.composedPreset(agent.ctx);
        return !!this.ctx.get('codeRuntime') && (!preset || preset === 'intellisense-ptc');
    }

    /** @brief Read the native loop position for ordinary tool query audit events. */
    position(agent: Agent): Position { return this.positions.get(agent.id) ?? { turn: 0, step: 0 }; }

    /** @brief Read only the native tool catalog visible to this agent. */
    physical(agent?: Agent): PhysicalTool[] {
        const tools = agent?.ctx.tools ?? this.ctx.tools;
        return tools.schemas(agent).filter(tool => !['exec', 'run_code'].includes(tool.name) && !this.nativeTools.get(agent?.id ?? '')?.names.has(tool.name)).map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tools.get(tool.name, agent)!.output.schema }));
    }

    /** @brief Refresh global metadata without changing any Profile configuration. */
    refresh(): void {
        const tools = new Map(this.physical().map(tool => [tool.id, tool]));
        for (const agent of this.ctx.agents.list()) for (const tool of this.physical(agent)) tools.set(tool.id, tool);
        this.registry.refresh([...tools.values()]);
    }

    /** @brief Resolve the session's immutable Profile reference against its current tool scope. */
    async registryFor(agent?: Agent): Promise<SemanticRegistry> {
        this.refresh();
        if (!agent) return this.registry;
        const registry = await this.profiles.forSession(agent.id);
        registry.refresh(this.physical(agent));
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async entries(agent: Agent): Promise<ManifestEntry[]> { return manifest(await this.registryFor(agent), this.aliases); }

    /** @brief Notify the native system-prompt assembler after session configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> { await this.registryFor(agent); if (!this.isPtc(agent)) await this.syncNative(agent); this.ctx.emit('system-prompt/change'); }

    /** @brief Publish only explicitly pinned commands and namespaces with their Profile briefs. */
    async prompt(agent: Agent): Promise<string> {
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        const entries = manifest(registry, this.aliases);
        const hints: NamespaceHint[] = [];
        for (const entry of entries) {
            const mapping = registry.effective().find(mapping => mapping.id === entry.tool);
            if (mapping?.alwaysVisible) hints.push({ path: entry.path, description: state.toolComments?.[entry.tool] ?? mapping.description ?? entry.doc });
        }
        for (const item of state.namespaces ?? []) if (item.alwaysVisible && entries.some(entry => entry.path.startsWith(item.path + '.'))) hints.push({ ...item, namespace: true });
        for (const item of (this.isPtc(agent) ? builtinCommands : [discoveryCommand])) if (item.path === discoveryCommand.path || (state.builtinVisible ?? defaultBuiltinVisible).includes(item.path)) hints.push(item);
        return namespaceDirectory(hints);
    }

    /** @brief Install scoped namespace aliases while keeping dispatch inside native guards and auditing. */
    async syncNative(agent: Agent): Promise<string[]> {
        const entries = await this.entries(agent);
        const fingerprint = JSON.stringify(entries);
        const previous = this.nativeTools.get(agent.id);
        if (previous?.fingerprint === fingerprint) return entries.map(entry => entry.path);
        for (const dispose of previous?.disposers ?? []) dispose();
        const state = { fingerprint, names: new Set(entries.filter(entry => entry.path !== entry.tool).map(entry => entry.path)), disposers: [] as (() => void)[] };
        this.nativeTools.set(agent.id, state);
        for (const entry of entries) {
            if (entry.path === entry.tool) continue;
            state.disposers.push(agent.ctx.tools.register({
                name: entry.path, description: entry.doc, parameters: nativeSchema(entry),
                output: { schema: {}, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                execute: async (args, parent) => {
                    const current = (await this.entries(agent)).find(candidate => candidate.path === entry.path && candidate.tool === entry.tool);
                    if (!current) throw new Error(`Execution denied: ${entry.path}`);
                    return this.dispatch(agent, current, nativeArgumentsFor(current, args), parent, 1);
                },
            }));
        }
        return entries.map(entry => entry.path);
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
        if (settled.isError) throw new Error(settled.error.message);
        return resultFor(entry, settled.value) ?? null;
    }

    /** @brief Release scoped aliases and the live Profile reference. */
    release(owner: string): void {
        for (const dispose of this.nativeTools.get(owner)?.disposers ?? []) dispose();
        this.nativeTools.delete(owner);
        this.positions.delete(owner);
        this.profiles.release(owner);
    }
}
