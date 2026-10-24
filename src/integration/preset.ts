import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-agent-preset-registry';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';

export const inject = ['agentPresets'];

/** @brief Register the explicit Intellisense PTC Agent Mode through the native preset lifecycle. */
export async function apply(ctx: Context): Promise<void> {
    for (const directory of ['intellisense_ptc', 'intellisense']) {
        const metadata = z.strictObject({ id: z.string(), name: z.string(), description: z.string(), order: z.number() }).parse(parse(await readFile(new URL(`../../presets/${directory}/preset.yml`, import.meta.url), 'utf8')));
        const plugins: unknown = parse(await readFile(new URL('../../presets/agent.cordis.yml', import.meta.url), 'utf8'), {
            customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
        });
        const problem = entryListProblem(plugins);
        if (problem) throw new Error(`Invalid ${metadata.name} composition: ${problem}`);
        const composition = plugins as PresetDefinition['plugins'];
        const presentation = composition.find(entry => entry.id === 'intellisense-presentation');
        if (!presentation) throw new Error('Missing Intellisense presentation');
        presentation.config = { mode: directory === 'intellisense_ptc' ? 'ptc' : 'native' };
        const dispose = await ctx.agentPresets.register({ ...metadata, plugins: composition });
        ctx.effect(() => dispose);
    }
}
