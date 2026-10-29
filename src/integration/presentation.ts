import type { Context } from '@deepseek-ai/cordis';
import { scopeChainOf, scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope';
import { z } from 'zod';
import '@deepseek-ai/dsh-tools';
import type {} from '../namespace/plugin.js';
import { NamespaceRuntime } from '../namespace/runtime.js';

export const name = 'intellisense-presentation';
export const inject = ['tools', 'namespaceIntegration'];
/** @brief Select the execution form and optionally fix the conversation Profile. */
export const Config = z.strictObject({ mode: z.enum(['native', 'ptc']).default('native'), profile: z.string().min(1).max(80).optional() });
/** @brief The configured execution form shared by tool presentation and initial prompts. */
export type PresentationMode = z.infer<typeof Config>['mode'];
const configurations = new WeakMap<ScopeKey, z.infer<typeof Config>>();

/** @brief Resolve the nearest configured presentation, including inherited preset scopes. */
export function presentationConfigFor(ctx: Context): z.infer<typeof Config> | undefined {
    for (const scope of scopeChainOf(scopeOf(ctx))) {
        const config = configurations.get(scope);
        if (config) return config;
    }
}

/** @brief Resolve the execution mode from the nearest presentation configuration. */
export function presentationFor(ctx: Context): PresentationMode | undefined { return presentationConfigFor(ctx)?.mode; }

/** @brief Declare one scoped tool presentation, matching dsh-agent-tool-presentation's lifecycle. */
export async function apply(ctx: Context, options: z.input<typeof Config>): Promise<void> {
    const config = Config.parse(options);
    const scope = scopeOf(ctx);
    if (!scope) throw new Error('Intellisense presentation requires an agent or preset scope');
    ctx.effect(() => { configurations.set(scope, config); return () => { configurations.delete(scope); }; });
    ctx.namespaceIntegration.register(ctx);
    if (config.mode === 'ptc') await ctx.isolate('namespaceRuntime').isolate('codeRuntime').plugin(NamespaceRuntime);
    ctx.tools.presentAs('native');
}
