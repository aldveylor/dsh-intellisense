import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import type {} from '../profile/plugin.js';
import { ProfileSessions } from '../profile/catalog/profiles.js';
import { createSearchEngines } from '../search/search.js';
import { NamespaceIntegration } from './namespace_integration.js';
import { Aliases } from '../profile/namespace/namespace.js';
import { registerSessionProfiles } from '../web/session_profile/routes.js';
import { registerManagement } from '../web/server/routes.js';
import { dshCompatibility } from '../compatibility/compatibility.js';
import { ptcToolName } from '../runtime/builtins.js';
import { executionInstructions } from '../profile/namespace/prompt.js';
import { PhysicalToolCatalog } from './tool_catalog.js';
import { CommandStatistics } from '../statistics/command_statistics.js';

export const name = 'command-namespaces';
export const inject = ['toolsNamespace', 'intellisenseStorage', 'tools', 'agents', 'systemPrompt', 'connection'];
/** @brief Configure the shared namespace alias catalog. */
export const Config = z.object({ aliasesFile: z.string().optional(), defaultSearchMethod: z.string().regex(/^[a-z][a-z0-9_]*$/).optional() }).prefault({});

/** @brief Independent namespace service shared by native tools, the UI, and optional PTC execution. */
declare module '@deepseek-ai/cordis' { interface Context { namespaceIntegration: NamespaceIntegration } }

/** @brief Mount namespace configuration, initial system hints and native discovery controls. */
export async function apply(ctx: Context, options: z.input<typeof Config> = {}): Promise<void> {
    const config = Config.parse(options);
    const aliases = Aliases.parse(config.aliasesFile ? parse(await readFile(config.aliasesFile, 'utf8')) : []);
    const store = ctx.intellisenseStorage;
    const catalog = new PhysicalToolCatalog();
    const namespace = ctx.toolsNamespace;
    const statistics = new CommandStatistics(store, { onError: error => ctx.logger.warn('Statistics persistence failed; dirty data will be retried.', error) });
    const profiles = new ProfileSessions(namespace, store, statistics);
    ctx.effect(() => async () => { await statistics.dispose(); await profiles.inspectStatistics.dispose(); });
    let namespaces: NamespaceIntegration | undefined;
    let initialization: Promise<void> | undefined;

    /** @brief Keep management recovery available when a persisted domain fails initialization. */
    async function initialize(recover = false): Promise<void> {
        if (!recover && initialization) return initialization;
        const previous = initialization;
        initialization = (async () => {
            if (recover) await previous?.catch(() => {});
            await namespace.initialize(recover);
            await statistics.load(recover);
            await profiles.inspectStatistics.load(recover);
            if (namespaces) return;
            const component = new NamespaceIntegration(ctx, namespace, catalog, profiles, aliases, createSearchEngines(config.defaultSearchMethod), statistics);
            namespaces = component;
            ctx.provide('intellisense', component.intellisense);
            ctx.provide('namespaceIntegration', component);
            registerSessionProfiles(ctx, namespace, component);
            ctx.on('agent/created', async ({ agent }) => { await component.configure(agent); });
            ctx.on('agent/disposed', async ({ agent }) => { await component.release(agent.id); });
            ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
                const assembled = await next();
                const agent = context.agent;
                if (agent && component.enabled(agent)) {
                    const directory = await component.prompt(agent);
                    if (directory) assembled.sections.push({ name: 'namespaces:directory', text: directory, interpolate: false });
                    const names = component.isPtc(agent) ? [ptcToolName] : await component.syncNative(agent);
                    dshCompatibility.presentTools(assembled, agent, names);
                    assembled.sections = assembled.sections.filter(section => !section.name.startsWith('tool:') && !section.name.startsWith('tools:'));
                    const instructions = executionInstructions(component.isPtc(agent) ? 'ptc' : 'native', (await component.entries(agent)).some(entry => entry.node.discovery));
                    if (instructions) assembled.sections.push({ name: 'namespaces:execution', text: instructions, interpolate: false });
                }
                return assembled;
            });
            for (const agent of ctx.agents.list()) await component.configure(agent);
        })();
        return initialization;
    }

    registerManagement(ctx, namespace, {
        catalog,
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
