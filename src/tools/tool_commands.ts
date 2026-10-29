import { ConversationRequiredError, ProfileLockedError, CurrentProfileDeletionError } from '../error.js';
import { ProfileWriteSchema, profileWrite, validateProfilePatch } from '../registry/profile_write.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import { mergeProfilePatch, profileSaveInformation } from './profile_save.js';
import { ProfileLock } from './profile_lock.js';
import { presentationConfigFor } from '../integration/presentation.js';
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
    const contract = (tool: string) => projectBuiltin(pluginCommands.find(tool)!, 'native');
    const lock = new ProfileLock();
    /** @brief Lock complete Profile reads and mutations across conversations, including read-modify-write operations. */
    const register = (definition: Parameters<typeof ctx.tools.register>[0]) => registerBuiltin(ctx, {
        ...definition,
        execute: (args, execution) => lock.run(async () => {
            execution.signal.throwIfAborted();
            return definition.execute(args, execution);
        }),
    });
    const output = { schema: { type: 'object', additionalProperties: true } as const, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
    /** @brief Validate and publish a Profile without replacing the conversation draft. */
    const save = async (agent: Agent, name: string | undefined, profile: ProfileData, defaultToolsDisabled = true): Promise<string | null> => {
        const registry = await registryFor(agent);
        const target = name ?? registry.snapshot().profile!;
        const original = catalog.snapshot().profiles?.includes(target) ? catalog.configuration(target) : registry.configuration();
        const root = { ...profile.root, description: profileTree(target, original, catalog.definitions).root.description };
        const configuration = profileConfiguration({ ...profile, root }, original, await commands(agent), catalog.definitions);
        if (defaultToolsDisabled && profile.root.children?.tools && profile.root.children.tools.disabled !== false
            && !configuration.builtinDisabled.includes('tools')) configuration.builtinDisabled.push('tools');
        const information = profileSaveInformation(profileTree(target, configuration, catalog.definitions), registry.tools().map(tool => tool.id));
        await catalog.saveProfile(target, configuration);
        return information;
    };
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_load', description: contract('tools_profile_load').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_load').parameterDocs!.name } }, output,
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name } = z.strictObject({ name: z.string().optional() }).parse(args);
            const registry = name === undefined ? await registryFor(execution.agent) : catalog;
            return JSON.parse(JSON.stringify(profileTree(name ?? registry.snapshot().profile!, registry.configuration(name), catalog.definitions))) as Record<string, z.infer<ReturnType<typeof z.json>>>;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_switch', description: contract('tools_profile_switch').description,
        parameters: { name: { type: 'string', required: true, description: contract('tools_profile_switch').parameterDocs!.name } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            if (presentationConfigFor(execution.agent.ctx)?.profile !== undefined) throw new ProfileLockedError();
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
            if (!execution.agent) throw new ConversationRequiredError();
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            await catalog.manageProfile('select', name, catalog.revision);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_save', description: contract('tools_profile_save').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_save').parameterDocs!.name }, profile: { type: 'object', additionalProperties: true, required: true, description: contract('tools_profile_save').parameterDocs!.profile } }, output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name, profile } = z.strictObject({ name: z.string().optional(), profile: ProfileWriteSchema }).parse(args);
            const target = name ?? (await registryFor(execution.agent)).snapshot().profile!;
            return save(execution.agent, name, { ...profile, name: target });
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_apply', description: contract('tools_profile_apply').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_apply').parameterDocs!.name }, value: { type: 'object', additionalProperties: true, required: true, description: contract('tools_profile_apply').parameterDocs!.value } },
        output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name, value } = z.strictObject({ name: z.string().optional(), value: z.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a Profile object patch') }).parse(args);
            const registry = name === undefined ? await registryFor(execution.agent) : catalog;
            validateProfilePatch(value);
            const target = name ?? registry.snapshot().profile!;
            const profile = profileWrite(profileTree(target, registry.configuration(name), catalog.definitions));
            const merged = ProfileWriteSchema.parse(mergeProfilePatch(profile, value));
            return save(execution.agent, name, ProfileSchema.parse({ ...merged, name: target }), false);
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_delete', description: contract('tools_profile_delete').description,
        parameters: { name: { type: 'string', required: true, description: contract('tools_profile_delete').parameterDocs!.name } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            const selected = (await registryFor(execution.agent)).snapshot().profile!;
            const target = name;
            if (target === selected) throw new CurrentProfileDeletionError(target);
            await catalog.manageProfile('delete', target, catalog.revision);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_profiles', description: contract('tools_profile_profiles').description, parameters: {},
        output: { ...output, schema: { type: 'object', properties: { profiles: { type: 'array', items: { type: 'string' }, required: true }, selected: { type: 'string', required: true } }, additionalProperties: false } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const registry = await registryFor(execution.agent);
            return { profiles: catalog.snapshot().profiles ?? [], selected: registry.snapshot().profile! };
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_annotation', description: contract('tools_profile_annotation').description, parameters: {},
        output: { ...output, schema: { type: 'string' } },
        execute: async (_args, execution) => execution.agent && !execution.agent.ctx.get('toolsNamespace')!.isPtc(execution.agent)
            ? JSON.stringify(ProfileWriteSchema.toJSONSchema()) : profileAnnotation,
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_commands', description: contract('tools_profile_commands').description, parameters: {},
        output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            return (await commands(execution.agent)).map(({ name, brief, paths, totalCalls }) => ({ name, brief, paths, totalCalls }));
        },
    })));
}
