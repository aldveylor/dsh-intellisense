import type { Context } from '@deepseek-ai/cordis';
import { scopeChainOf, scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope';
import { z } from 'zod';
import '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-ptc-runtime';

export const name = 'intellisense-presentation';
export const inject = ['tools'];
/** @brief Select native namespace calls or the native PTC run_code transport. */
export const Config = z.strictObject({ mode: z.enum(['native', 'ptc']) });
/** @brief The configured execution form shared by tool presentation and initial prompts. */
export type PresentationMode = z.infer<typeof Config>['mode'];
const modes = new WeakMap<ScopeKey, PresentationMode>();

/** @brief Resolve the nearest configured presentation, including inherited preset scopes. */
export function presentationFor(ctx: Context): PresentationMode | undefined {
    for (const scope of scopeChainOf(scopeOf(ctx))) {
        const mode = modes.get(scope);
        if (mode) return mode;
    }
}

/** @brief Declare one scoped tool presentation, matching dsh-agent-tool-presentation's lifecycle. */
export function apply(ctx: Context, options: z.input<typeof Config>): void {
    const config = Config.parse(options);
    const scope = scopeOf(ctx);
    if (!scope) throw new Error('Intellisense presentation requires an agent or preset scope');
    ctx.effect(() => { modes.set(scope, config.mode); return () => { modes.delete(scope); }; });
    if (config.mode === 'native') ctx.tools.presentAs('native');
    else ctx.inject(['ptcRuntime'], runtimeCtx => { runtimeCtx.tools.presentAs('ptc'); });
}
