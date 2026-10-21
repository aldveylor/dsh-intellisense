import type { Context } from '@deepseek-ai/cordis';
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import '@deepseek-ai/dsh-system-prompt';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-tools';
import { DshStore } from './storage/store.js';
import { SemanticRegistry } from './registry/registry.js';
import { TypeScriptAdapter } from './dsh/adapter.js';
import { OrganizationService, proposalSchema } from './dsh/organization.js';
import { registerManagement } from './web/routes.js';

export const name = 'dsh-ts-intellisense';
export const inject = ['llm', 'tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'subagents', 'connection'];
/** @brief Public plugin options; execution permissions remain owned by native DSH policies. */
export interface Config { route?: string; provider?: string; model?: string; timeoutMs?: number }

/** @brief Mount an npm-installed Cordis plugin using DSH's native services. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const config = { route: options.route ?? 'ts-repl', provider: options.provider ?? 'deepseek-official', model: options.model ?? 'deepseek-flash', timeoutMs: options.timeoutMs ?? 30_000 };
    if (config.route === config.provider) throw new Error('The TypeScript route must differ from its upstream provider');
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100) throw new Error('Invalid timeout');
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const store = new DshStore(unit);
    const registry = new SemanticRegistry(store); await registry.load();
    const organization = new OrganizationService(ctx, registry, config.provider, config.model);
    ctx.tools.register({
        name: 'tools_namespace',
        description: 'Sort tools into semantic namespaces. Return an organization proposal for human approval in the TypeScript tools management UI.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
            schema: { type: 'object', properties: { id: { type: 'string' }, proposal: proposalSchema } },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('Namespace organization requires a live agent');
            return organization.propose(execution.agent, execution.signal, await adapter.registryFor(execution.agent));
        },
    });
    const adapter = new TypeScriptAdapter(ctx, config, registry, store);
    ctx.llm.registerAdapter([config.route], adapter);
    ctx.on('llm/stream', (request, next) => {
        const agent = request.sessionId ? ctx.agents.get(request.sessionId) : undefined;
        if (isAgentLoopRequest(request) && !request.purpose && request.provider !== config.route && agent?.options.provider === config.route) return adapter.stream(request);
        return next();
    });
    ctx.on('agent/created', async ({ agent }) => {
        if (agent.options.provider === config.route) {
            // REPL dispatches physical tools directly through the native execution pipeline.
            agent.ctx.tools.presentAs('native');
            await adapter.registryFor(agent);
        }
        return undefined;
    });
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        if (context.agent?.options.provider === config.route) {
            assembled.tools = [];
            assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
        }
        return assembled;
    });
    ctx.on('agent/disposed', ({ agent }) => { void adapter.release(agent.id); });
    for (const agent of ctx.agents.list()) {
        if (agent.options.provider === config.route) await adapter.registryFor(agent);
    }
    registerManagement(ctx, registry, adapter, organization);
    ctx.effect(() => async () => { await adapter.dispose(); await unit.close(); });
}

export { SessionRuntime } from './runtime/session.js';
export { IsolatedSession } from './runtime/isolated.js';
export { SemanticRegistry } from './registry/registry.js';
