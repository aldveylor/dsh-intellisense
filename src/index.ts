import type { Context } from '@deepseek-ai/cordis';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import '@deepseek-ai/dsh-system-prompt';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-tools';
import { DshStore } from './storage/store.js';
import { SemanticRegistry } from './registry/registry.js';
import { intellisense } from './integration/intellisense.js';
import { TextPtcRoute } from './integration/route.js';
import { TextPtcAdapter } from './integration/adapter.js';
import { RuntimeHost, RuntimeConfig } from './runtime/host.js';
import { Config as ProtocolConfig } from './protocol/config.js';
import { Aliases } from './integration/namespace.js';
import { OrganizationService } from './integration/organization.js';
import { ProfileSessions } from './registry/profiles.js';
import { registerToolCommands } from './integration/tool_commands.js';
import { registerManagement } from './management/server/routes.js';

export const name = 'dsh-ts-intellisense';
export const inject = ['llm', 'tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'subagents', 'connection'];
/** @brief Fail invalid settings at loading; all execution and protocol budgets are configurable. */
export const Config = RuntimeConfig.extend({ protocol: ProtocolConfig.default(() => ProtocolConfig.parse({})), aliasesFile: z.string().optional() });
/** @brief Public options for the active text-execution mode. */
export type Config = z.input<typeof Config>;

/** @brief Register fenced text execution and native exec tool calls. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const config = Config.parse(options);
    const { protocol, aliasesFile, ...runtimeOptions } = config;
    const runtime = new RuntimeHost(runtimeOptions);
    ctx.provide('codeRuntime', runtime);
    ctx.provide('intellisense', { complete: (query, entries) => intellisense(query, entries, runtime) });
    ctx.effect(() => ctx.llm.registerAdapter(['text-ptc'], new TextPtcRoute(ctx.llm)));
    const aliases = Aliases.parse(parse(await readFile(aliasesFile ?? new URL('../presets/text_ptc/aliases.yml', import.meta.url), 'utf8')));
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
    ctx.effect(() => async () => { await runtime.dispose(); await unit.close(); });
    const store = new DshStore(unit);
    const registry = new SemanticRegistry(store); await registry.load();
    const profiles = new ProfileSessions(registry, store);
    const adapter = new TextPtcAdapter(ctx, registry, profiles, runtime, aliases, protocol);
    ctx.effect(() => async () => { await adapter.dispose(); });
    registerToolCommands(ctx, registry, profiles, agent => adapter.registryFor(agent), agent => adapter.configurationChanged(agent));
    ctx.on('llm/stream', (request, next) => {
        const agent = request.sessionId ? ctx.agents.get(request.sessionId) : undefined;
        if (isAgentLoopRequest(request) && !request.purpose && agent && agent.session.header.origin !== 'subagent') return adapter.stream(request);
        return next();
    });
    const configure = async (agent: Parameters<typeof adapter.registryFor>[0]): Promise<void> => {
        if (agent && agent.session.header.origin !== 'subagent') { agent.ctx.tools.presentAs('native'); await adapter.registryFor(agent); }
    };
    ctx.on('agent/created', async ({ agent }) => { await configure(agent); });
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        if (context.agent && context.agent.session.header.origin !== 'subagent') {
            assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
            const prompt = await adapter.prompt(context.agent, context.signal ?? new AbortController().signal);
            assembled.sections.push({ name: 'text-ptc:execution', text: prompt.instructions, interpolate: false }, { name: 'text-ptc:namespaces', text: prompt.namespaces, interpolate: false });
            assembled.tools = [];
        }
        return assembled;
    });
    ctx.on('agent/disposed', async ({ agent }) => { await adapter.release(agent.id); });
    for (const agent of ctx.agents.list()) await configure(agent);
    registerManagement(ctx, registry, adapter, new OrganizationService(ctx, registry));
}

export { RuntimeHost } from './runtime/host.js';
export { TextExecAdapter } from './protocol/adapter.js';
export { SemanticRegistry } from './registry/registry.js';
