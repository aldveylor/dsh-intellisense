import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-agent-preset-registry';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry';
import { version } from '../compatibility/version.js';

export const inject = ['agentPresets'];

/** @brief Register complete declarative Intellisense presets through the native preset lifecycle. */
export async function apply(ctx: Context): Promise<void> {
    for (const directory of ['intellisense_ptc', 'intellisense']) {
        const metadata = z.strictObject({ id: z.string(), name: z.string(), description: z.string(), order: z.number() }).parse(parse(await readFile(new URL(`../../presets/${directory}/preset.yml`, import.meta.url), 'utf8')));
        const plugins: unknown = parse(await readFile(new URL(`../../presets/${directory}/agent.cordis.yml`, import.meta.url), 'utf8'), {
            customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
        });
        const problem = entryListProblem(plugins);
        if (problem) throw new Error(`Invalid ${metadata.name} composition: ${problem}`);
        const composition = plugins as PresetDefinition['plugins'];
        version.lt('0.2.2-alpha.2', () => {
            const delegation = composition.find(plugin => plugin.id === 'delegation');
            const children = delegation?.config as PresetDefinition['plugins'] | undefined;
            if (!delegation?.group || !Array.isArray(children)) throw new Error(`Invalid ${metadata.name} composition: missing delegation group`);
            const index = children.findIndex(plugin => plugin.id === 'tool-subagent-control');
            if (index < 0) throw new Error(`Invalid ${metadata.name} composition: missing subagent control`);
            children.splice(index + 1, 0, { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' });
        });
        const dispose = await ctx.agentPresets.register({ ...metadata, plugins: composition });
        ctx.effect(() => dispose);
    }
}
