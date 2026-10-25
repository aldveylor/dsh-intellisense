import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import * as namespacePlugin from './namespace/namespace_plugin.js';
import { RuntimeConfig } from './runtime/host.js';

export const name = 'dsh-intellisense';
export const inject = ['tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'connection'];
/** @brief Configure aliases and the isolated namespace execution backend. */
export const Config = RuntimeConfig.extend({ aliasesFile: z.string().optional(), defaultSearchMethod: z.string().regex(/^[a-z][a-z0-9_]*$/).optional() });
/** @brief Public plugin settings; each presentation selects its execution mode. */
export type Config = z.input<typeof Config>;

/** @brief Mount namespace discovery and scoped namespace execution without intercepting model streams. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const { aliasesFile, defaultSearchMethod, ...runtimeOptions } = Config.parse(options);
    ctx.provide('codeRuntimeOptions', runtimeOptions);
    await ctx.plugin(namespacePlugin, { aliasesFile, defaultSearchMethod });
}

export { RuntimeHost } from './runtime/host.js';
export { SemanticRegistry } from './registry/registry.js';
export { NamespaceComponent } from './namespace/namespace_component.js';

export { SearchEngineRegistry } from './search/engine_registry.js';
export type { SearchEngine, SearchSelection, SearchDocument, SearchSelector, SearchField } from './search/engine_registry.js';
