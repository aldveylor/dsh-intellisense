import { registerBuiltin } from './builtin_trace.js';
import type { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { type CommandBrief, ProfileSchema, profileConfiguration, profileTree, profileAnnotation } from '../registry/profile_tree.js';

/** @brief Register only Profile load/save and data access. */
export function registerToolCommands(ctx: Context, catalog: SemanticRegistry, profiles: ProfileSessions, registryFor: (agent: Agent) => Promise<SemanticRegistry>, changed: (agent: Agent) => Promise<void>, commands: () => Promise<CommandBrief[]>): void {
    const queues = new Map<string, Promise<unknown>>();
    /** @brief Serialize configuration changes belonging to one conversation. */
    const register = (definition: Parameters<typeof ctx.tools.register>[0]) => registerBuiltin(ctx, {
        ...definition,
        execute: (args, execution) => {
            const id = execution.agent?.id ?? '';
            const prior = queues.get(id) ?? Promise.resolve();
            const work = prior.catch(() => {}).then(() => { execution.signal.throwIfAborted(); return definition.execute(args, execution); });
            queues.set(id, work);
            void work.finally(() => { if (queues.get(id) === work) queues.delete(id); }).catch(() => {});
            return work;
        },
    });
    const output = { schema: { type: 'object', additionalProperties: true } as const, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_load', description: 'Load a named Profile into this conversation. With no name, return the current draft.',
        parameters: { name: { type: 'string' } }, output,
        execute: async ({ name }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = name === undefined ? await registryFor(execution.agent) : await profiles.load(execution.agent.id, name);
            if (name !== undefined) await changed(execution.agent);
            return JSON.parse(JSON.stringify(profileTree(registry.snapshot().profile!, registry.configuration()))) as Record<string, z.infer<ReturnType<typeof z.json>>>;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_save', description: 'Save an editable Profile tree to the named catalog entry and this conversation. Omitted name defaults to the current Profile.',
        parameters: { name: { type: 'string' }, profile: { type: 'object', additionalProperties: true, required: true } }, output: { ...output, schema: { type: 'null' } },
        execute: async ({ name, profile: input }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            const profile = ProfileSchema.parse(input);
            const target = name ?? registry.snapshot().profile!;
            const configuration = profileConfiguration(profile, registry.configuration(), await commands());
            await catalog.saveProfile(target, configuration);
            await registry.replaceConfiguration(configuration, target);
            await changed(execution.agent);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_annotation', description: 'Return the editable Profile data model documentation.', parameters: {},
        output: { ...output, schema: { type: 'string' } },
        execute: async (_args, execution) => execution.agent && !execution.agent.ctx.get('commandNamespaces')!.isPtc(execution.agent)
            ? JSON.stringify(ProfileSchema.toJSONSchema()) : profileAnnotation,
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_commands', description: 'Show all commands, including commands absent from the current context, with their original physical names and descriptions.', parameters: {},
        output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            return (await commands()).map(({ name, brief }) => ({ name, brief }));
        },
    })));
}
