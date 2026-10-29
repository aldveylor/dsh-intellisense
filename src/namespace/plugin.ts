import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { storageVersion } from '../storage/version.js';
import { DshStore } from '../storage/store.js';
import { SemanticRegistry } from '../registry/registry.js';
import { ProfileSessions } from '../registry/profiles.js';
import { createSearchEngines } from '../search/search.js';
import { NamespaceIntegration } from '../integration/namespace_integration.js';
import { NamespaceComponent } from './component.js';
import type { ToolsNamespace } from './service.js';
import { Aliases } from './namespace.js';
import { registerSessionProfiles } from '../web/session_profile/routes.js';
import { registerManagement } from '../web/server/routes.js';
import { ptcToolName } from '../runtime/builtins.js';
import { executionInstructions } from './prompt.js';
import { CommandStatistics } from '../statistics/command_statistics.js';

export const name = 'command-namespaces';
export const inject = ['tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'connection'];
/** @brief Configure the shared namespace alias catalog. */
export const Config = z.object({ aliasesFile: z.string().optional(), defaultSearchMethod: z.string().regex(/^[a-z][a-z0-9_]*$/).optional() }).prefault({});

/** @brief Independent namespace service shared by native tools, the UI, and optional PTC execution. */
declare module '@deepseek-ai/cordis' { interface Context { toolsNamespace: ToolsNamespace; namespaceIntegration: NamespaceIntegration } }

/** @brief Mount namespace configuration, initial system hints and native discovery controls. */
export async function apply(ctx: Context, options: z.input<typeof Config> = {}): Promise<void> {
    const config = Config.parse(options);
    const aliases = Aliases.parse(config.aliasesFile ? parse(await readFile(config.aliasesFile, 'utf8')) : []);
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1, 2], tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const store = new DshStore(unit);
    const snapshotUnit = await backend.kv.open({ name: 'intellisense_profile_snapshots', version: 1, tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const registry = new SemanticRegistry(store, 'global', undefined, new DshStore(snapshotUnit));
    const statistics = new CommandStatistics(store, { onError: error => ctx.logger.warn('Statistics persistence failed; dirty data will be retried.', error) });
    const profiles = new ProfileSessions(registry, store, statistics);
    ctx.effect(() => async () => { try { await statistics.dispose(); await profiles.inspectStatistics.dispose(); } finally { try { await registry.snapshots.flush(); } finally { await snapshotUnit.close(); await unit.close(); } } });
    let namespaces: NamespaceIntegration | undefined;
    let initialization: Promise<void> | undefined;

    /** @brief Keep management recovery available when a persisted domain fails initialization. */
    async function initialize(recover = false): Promise<void> {
        if (!recover && initialization) return initialization;
        const previous = initialization;
        initialization = (async () => {
            if (recover) await previous?.catch(() => {});
            await registry.load(recover);
            await statistics.load(recover);
            await profiles.inspectStatistics.load(recover);
            if (namespaces) return;
            const namespace = new NamespaceComponent(ctx, registry);
            const component = new NamespaceIntegration(ctx, namespace, profiles, aliases, createSearchEngines(config.defaultSearchMethod), statistics);
            namespaces = component;
            ctx.provide('intellisense', component.intellisense);
            ctx.provide('toolsNamespace', namespace);
            ctx.provide('namespaceIntegration', component);
            registerSessionProfiles(ctx, registry, component);
            ctx.on('agent/created', async ({ agent }) => { await component.configure(agent); });
            ctx.on('agent/disposed', async ({ agent }) => { await component.release(agent.id); });
            ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
                const assembled = await next();
                const agent = context.agent;
                if (agent && component.enabled(agent)) {
                    const directory = await component.prompt(agent);
                    if (directory) assembled.sections.push({ name: 'namespaces:directory', text: directory, interpolate: false });
                    if (!component.isPtc(agent)) {
                        const names = new Set(await component.syncNative(agent));
                        assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
                        assembled.tools = agent.ctx.tools.schemas(agent).filter(tool => names.has(tool.name));
                    } else {
                        assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
                        assembled.tools = agent.ctx.tools.schemas(agent).filter(tool => tool.name === ptcToolName);
                    }
                    const instructions = executionInstructions(component.isPtc(agent) ? 'ptc' : 'native', (await component.entries(agent)).some(entry => entry.node.discovery));
                    if (instructions) assembled.sections.push({ name: 'namespaces:execution', text: instructions, interpolate: false });
                }
                return assembled;
            });
            for (const agent of ctx.agents.list()) await component.configure(agent);
        })();
        return initialization;
    }

    registerManagement(ctx, registry, {
        statistics,
        inspectStatistics: profiles.inspectStatistics,
        refresh: async () => { await initialize(); await namespaces!.refresh(); },
        recover: () => initialize(true),
    });
    try { await initialize(); }
    catch (error) { ctx.logger.warn('Intellisense data could not be loaded; use Reset in the management panel to recover invalid portions.', error); }
}

export { SearchEngineRegistry } from '../search/engine_registry.js';
export type { SearchEngine, SearchSelection, SearchDocument, SearchSelector, SearchField } from '../search/engine_registry.js';
