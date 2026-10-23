import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import * as namespacePlugin from './integration/namespace_plugin.js';
import { NamespaceRuntime } from './integration/namespace_runtime.js';
import { RuntimeHost, RuntimeConfig } from './runtime/host.js';

export const name = 'dsh-intellisense';
export const inject = ['llm', 'tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'subagents', 'connection'];
/** @brief Configure the default presentation and the isolated native run_code backend. */
export const Config = RuntimeConfig.extend({ mode: z.enum(['native', 'ptc']).default('ptc'), aliasesFile: z.string().optional() });
/** @brief Public plugin settings; preset presentation config overrides the default mode. */
export type Config = z.input<typeof Config>;

/** @brief Mount namespace discovery and the native PTC runtime without intercepting model streams. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const { mode, aliasesFile, ...runtimeOptions } = Config.parse(options);
    const runtime = new RuntimeHost(runtimeOptions);
    ctx.provide('codeRuntime', runtime);
    ctx.effect(() => () => runtime.dispose());
    await ctx.plugin(NamespaceRuntime);
    await ctx.plugin(namespacePlugin, { mode, aliasesFile });
}

export { RuntimeHost } from './runtime/host.js';
export { SemanticRegistry } from './registry/registry.js';
export { NamespaceComponent } from './integration/namespace_component.js';
