import type { Context } from '@deepseek-ai/cordis';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import '@deepseek-ai/dsh-system-prompt';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-tools';
import { DshStore } from './storage/store.js';
import { SemanticRegistry } from './registry/registry.js';
import { TypeScriptAdapter } from './dsh/adapter.js';
import { OrganizationService } from './dsh/organization.js';
import { CompletionSettings } from './protocol/history.js';
import { ProfileSessions } from './registry/profiles.js';
import { registerToolCommands } from './dsh/tool_commands.js';
import { registerManagement } from './web/routes.js';

export const name = 'dsh-ts-intellisense';
export const inject = ['llm', 'tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'subagents', 'connection'];
/** @brief Public plugin options; execution permissions remain owned by native DSH policies. */
export interface Config { timeoutMs?: number }

/** @brief Mount an npm-installed Cordis plugin using DSH's native services. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const config = { timeoutMs: options.timeoutMs ?? 30_000 };
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100) throw new Error('Invalid timeout');
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const store = new DshStore(unit);
    const registry = new SemanticRegistry(store); await registry.load();
    const organization = new OrganizationService(ctx, registry);
    const profiles = new ProfileSessions(registry, store);
    const settings = new CompletionSettings(store); await settings.load();
    const adapter = new TypeScriptAdapter(ctx, config, registry, store, profiles, settings);
    registerToolCommands(ctx, registry, profiles, agent => adapter.registryFor(agent), agent => adapter.configurationChanged(agent));
    ctx.on('llm/stream', (request, next) => {
        const agent = request.sessionId ? ctx.agents.get(request.sessionId) : undefined;
        if (isAgentLoopRequest(request) && !request.purpose && agent && agent.session.header.origin !== 'subagent') return adapter.stream(request);
        return next();
    });
    ctx.on('agent/created', async ({ agent }) => {
        if (agent.session.header.origin !== 'subagent') {
            // REPL dispatches physical tools directly through the native execution pipeline.
            agent.ctx.tools.presentAs('native');
            await adapter.registryFor(agent);
        }
        return undefined;
    });
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        if (context.agent && context.agent.session.header.origin !== 'subagent') {
            // Native request headers retain callable tool schemas for trajectory inspection.
            // The adapter removes tools from the actual upstream request.
            assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
        }
        return assembled;
    });
    ctx.on('agent/disposed', ({ agent }) => { void adapter.release(agent.id); });
    for (const agent of ctx.agents.list()) {
        if (agent.session.header.origin !== 'subagent') {
            agent.ctx.tools.presentAs('native');
            await adapter.registryFor(agent);
        }
    }
    registerManagement(ctx, registry, adapter, organization, settings);
    ctx.effect(() => async () => { await adapter.dispose(); await unit.close(); });
}

export { SessionRuntime } from './runtime/session.js';
export { IsolatedSession } from './runtime/isolated.js';
export { SemanticRegistry } from './registry/registry.js';
