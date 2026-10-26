import { registerBuiltin } from './builtin_trace.js';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { type CommandBrief, ProfileSchema, profileConfiguration, profileTree, profileAnnotation } from '../registry/profile_tree.js';

/** @brief Register Profile load/save/delete and data access. */
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
        name: 'tools_profile_switch', description: 'Switch this conversation to a named catalog Profile.',
        parameters: { name: { type: 'string', required: true, description: 'Existing catalog Profile to select for this conversation.' } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            await profiles.load(execution.agent.id, name);
            await changed(execution.agent);
            const text = `Profile updated to ${name}`;
            execution.agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'intellisense-profile', form: 'notice', summary: text } }));
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_save', description: 'Save a Profile tree to the catalog. Omitted or undefined name uses the current conversation Profile name, ignoring profile.name. Call tools.profile.switch(name) to apply the saved Profile.',
        parameters: { name: { type: 'string', description: 'Target catalog name; defaults to the current conversation Profile name.' }, profile: { type: 'object', additionalProperties: true, required: true, description: 'Complete editable Profile tree.' } }, output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name, profile } = z.strictObject({ name: z.string().optional(), profile: ProfileSchema }).parse(args);
            const registry = await registryFor(execution.agent);
            const target = name ?? registry.snapshot().profile!;
            const configuration = profileConfiguration(profile, registry.configuration(), await commands());
            await catalog.saveProfile(target, configuration);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_delete', description: 'Delete a named catalog Profile. The current conversation Profile cannot be deleted.',
        parameters: { name: { type: 'string', required: true, description: 'Catalog Profile to delete.' } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            const selected = (await registryFor(execution.agent)).snapshot().profile!;
            const target = name;
            if (target === selected) throw new Error(`Current Profile cannot be deleted: ${target}`);
            await catalog.manageProfile('delete', target, catalog.snapshot().revision);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_profiles', description: 'Return available Profile names and the currently selected conversation Profile.', parameters: {},
        output: { ...output, schema: { type: 'object', properties: { profiles: { type: 'array', items: { type: 'string' }, required: true }, selected: { type: 'string', required: true } }, additionalProperties: false } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            return { profiles: catalog.snapshot().profiles ?? [], selected: registry.snapshot().profile! };
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_annotation', description: 'Return the editable Profile data model documentation.', parameters: {},
        output: { ...output, schema: { type: 'string' } },
        execute: async (_args, execution) => execution.agent && !execution.agent.ctx.get('commandNamespaces')!.isPtc(execution.agent)
            ? JSON.stringify(ProfileSchema.toJSONSchema()) : profileAnnotation,
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_commands', description: 'All catalog commands with original physical names, summaries and total calls across all sessions.', parameters: {},
        output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            return (await commands()).map(({ name, brief, totalCalls }) => ({ name, brief, totalCalls }));
        },
    })));
}
