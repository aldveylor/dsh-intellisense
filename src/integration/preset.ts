import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-agent-preset-registry';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';

export const inject = ['agentPresets'];

/** @brief Register the explicit Text PTC Agent Mode through the native preset lifecycle. */
export async function apply(ctx: Context): Promise<void> {
    const metadata = z.strictObject({ id: z.string(), name: z.string(), description: z.string(), order: z.number() }).parse(parse(await readFile(new URL('../../presets/text_ptc/preset.yml', import.meta.url), 'utf8')));
    const plugins: unknown = parse(await readFile(new URL('../../presets/text_ptc/agent.cordis.yml', import.meta.url), 'utf8'), {
        customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
    });
    const problem = entryListProblem(plugins);
    if (problem) throw new Error(`Invalid Text PTC composition: ${problem}`);
    const dispose = await ctx.agentPresets.register({ ...metadata, plugins: plugins as PresetDefinition['plugins'] });
    ctx.effect(() => dispose);
}
