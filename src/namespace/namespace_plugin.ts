import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DshStore } from '../storage/store.js';
import { SemanticRegistry } from '../registry/registry.js';
import { ProfileSessions } from '../registry/profiles.js';
import { createSearchEngines } from '../search/search.js';
import { NamespaceComponent } from './namespace_component.js';
import { Aliases } from './namespace.js';
import { registerManagement } from '../management/server/routes.js';
import { ptcToolName } from '../runtime/builtins.js';
import { executionInstructions } from './prompt.js';

export const name = 'command-namespaces';
export const inject = ['tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'connection'];
/** @brief Configure the shared namespace alias catalog. */
export const Config = z.object({ aliasesFile: z.string().optional(), defaultSearchMethod: z.string().regex(/^[a-z][a-z0-9_]*$/).optional() }).prefault({});

/** @brief Independent namespace service shared by native tools, the UI, and optional PTC execution. */
declare module '@deepseek-ai/cordis' { interface Context { commandNamespaces: NamespaceComponent } }

/** @brief Mount namespace configuration, initial system hints and native discovery controls. */
export async function apply(ctx: Context, options: z.input<typeof Config> = {}): Promise<void> {
    const config = Config.parse(options);
    const aliases = Aliases.parse(config.aliasesFile ? parse(await readFile(config.aliasesFile, 'utf8')) : []);
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
    ctx.effect(() => () => unit.close());
    const store = new DshStore(unit);
    const registry = new SemanticRegistry(store); await registry.load();
    const profiles = new ProfileSessions(registry, store);
    const namespaces = new NamespaceComponent(ctx, registry, profiles, aliases, createSearchEngines(config.defaultSearchMethod));
    ctx.provide('commandNamespaces', namespaces);
    registerManagement(ctx, registry, namespaces);
    ctx.on('agent/created', async ({ agent }) => { await namespaces.configure(agent); });
    ctx.on('agent/disposed', async ({ agent }) => { await namespaces.release(agent.id); });
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        const agent = context.agent;
        if (agent && namespaces.enabled(agent)) {
            if (namespaces.isPtc(agent)) assembled.sections.push({ name: 'namespaces:directory', text: await namespaces.prompt(agent), interpolate: false });
            if (!namespaces.isPtc(agent)) {
                const names = new Set(await namespaces.syncNative(agent));
                assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
                assembled.tools = agent.ctx.tools.schemas(agent).filter(tool => names.has(tool.name));
            } else {
                assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
                assembled.tools = agent.ctx.tools.schemas(agent).filter(tool => tool.name === ptcToolName);
            }
            assembled.sections.push({ name: 'namespaces:execution', text: executionInstructions(namespaces.isPtc(agent) ? 'ptc' : 'native'), interpolate: false });
        }
        return assembled;
    });
    for (const agent of ctx.agents.list()) await namespaces.configure(agent);
}

export { SearchEngineRegistry } from '../search/engine_registry.js';
export type { SearchEngine, SearchSelection, SearchDocument, SearchSelector, SearchField } from '../search/engine_registry.js';
