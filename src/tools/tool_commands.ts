import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import { mergeProfilePatch, profileSaveInformation } from './profile_save.js';
import { presentationConfigFor, presentationFor } from '../integration/presentation.js';
import { registerBuiltin } from './builtin_trace.js';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { type CommandBrief, type ProfileData, ProfileSchema, profileConfiguration, profileTree, profileAnnotation } from '../registry/profile_tree.js';

/** @brief Register Profile management commands and data access. */
export function registerToolCommands(ctx: Context, catalog: SemanticRegistry, profiles: ProfileSessions, registryFor: (agent: Agent) => Promise<SemanticRegistry>, changed: (agent: Agent) => Promise<void>, commands: (agent: Agent) => Promise<CommandBrief[]>): void {
    /** @brief Resolve mode-specific comments in the registration scope. */
    const contract = (tool: string) => projectBuiltin(pluginCommands.find(tool)!, presentationFor(ctx) ?? 'native');
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
    /** @brief Validate and publish a Profile without replacing the conversation draft. */
    const save = async (agent: Agent, name: string | undefined, profile: ProfileData): Promise<string | null> => {
        const registry = await registryFor(agent);
        const target = name ?? registry.snapshot().profile!;
        const original = catalog.snapshot().profiles?.includes(target) ? catalog.configuration(target) : registry.configuration();
        let completed = false;
        const configuration = profileConfiguration(profile, original, await commands(agent), () => { completed = true; });
        if (profile.root.children?.find(node => node.name === 'tools')?.disabled !== false
            && !configuration.builtinDisabled.includes('tools')) configuration.builtinDisabled.push('tools');
        const information = profileSaveInformation(profileTree(target, configuration), registry.tools().map(tool => tool.id), completed);
        await catalog.saveProfile(target, configuration);
        return information;
    };
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_load', description: contract('tools_profile_load').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_load').parameterDocs!.name } }, output,
        execute: async ({ name }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = name === undefined ? await registryFor(execution.agent) : catalog;
            return JSON.parse(JSON.stringify(profileTree(name ?? registry.snapshot().profile!, registry.configuration(name)))) as Record<string, z.infer<ReturnType<typeof z.json>>>;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_switch', description: contract('tools_profile_switch').description,
        parameters: { name: { type: 'string', required: true, description: contract('tools_profile_switch').parameterDocs!.name } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            if (presentationConfigFor(execution.agent.ctx)?.profile !== undefined) throw new Error('session_profile_locked');
            await profiles.load(execution.agent.id, name);
            await changed(execution.agent);
            const text = `Profile updated to ${name}`;
            execution.agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'intellisense-profile', form: 'notice', summary: text } }));
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_setdefault', description: contract('tools_profile_setdefault').description,
        parameters: { name: { type: 'string', required: true, description: contract('tools_profile_setdefault').parameterDocs!.name } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            await catalog.manageProfile('select', name, catalog.snapshot().revision);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_save', description: contract('tools_profile_save').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_save').parameterDocs!.name }, profile: { type: 'object', additionalProperties: true, required: true, description: contract('tools_profile_save').parameterDocs!.profile } }, output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name, profile } = z.strictObject({ name: z.string().optional(), profile: ProfileSchema }).parse(args);
            return save(execution.agent, name, profile);
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_apply', description: contract('tools_profile_apply').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_apply').parameterDocs!.name }, value: { type: 'object', additionalProperties: true, required: true, description: contract('tools_profile_apply').parameterDocs!.value } },
        output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name, value } = z.strictObject({ name: z.string().optional(), value: z.record(z.string(), z.json()) }).parse(args);
            const registry = name === undefined ? await registryFor(execution.agent) : catalog;
            const profile = JSON.parse(JSON.stringify(profileTree(name ?? registry.snapshot().profile!, registry.configuration(name))));
            return save(execution.agent, name, ProfileSchema.parse(mergeProfilePatch(profile, value)));
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_delete', description: contract('tools_profile_delete').description,
        parameters: { name: { type: 'string', required: true, description: contract('tools_profile_delete').parameterDocs!.name } },
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
        name: 'tools_profile_profiles', description: contract('tools_profile_profiles').description, parameters: {},
        output: { ...output, schema: { type: 'object', properties: { profiles: { type: 'array', items: { type: 'string' }, required: true }, selected: { type: 'string', required: true } }, additionalProperties: false } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            return { profiles: catalog.snapshot().profiles ?? [], selected: registry.snapshot().profile! };
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_annotation', description: contract('tools_profile_annotation').description, parameters: {},
        output: { ...output, schema: { type: 'string' } },
        execute: async (_args, execution) => execution.agent && !execution.agent.ctx.get('commandNamespaces')!.isPtc(execution.agent)
            ? JSON.stringify(ProfileSchema.toJSONSchema()) : profileAnnotation,
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_commands', description: contract('tools_profile_commands').description, parameters: {},
        output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            return (await commands(execution.agent)).map(({ name, brief, paths, totalCalls }) => ({ name, brief, paths, totalCalls }));
        },
    })));
}
