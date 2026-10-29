import { ConversationRequiredError, ProfileLockedError, CurrentProfileDeletionError } from '../error.js';
import { ProfileWriteSchema, validateProfilePatch, type ProfilePatch } from '../registry/profile_write.js';
import { pluginCommands, projectBuiltin } from '../runtime/builtins.js';
import { writeProfile } from './profile_save.js';
import { ProfileLock } from './profile_lock.js';
import { presentationConfigFor } from '../integration/presentation.js';
import { registerBuiltin } from './builtin_trace.js';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SemanticRegistry } from '../registry/registry.js';
import type { NamespaceIntegration } from '../integration/namespace_integration.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { type CommandBrief, profileTree, profileAnnotation } from '../registry/profile_tree.js';

/** @brief Register Profile management commands and data access. */
export function registerToolCommands(ctx: Context, catalog: SemanticRegistry, profiles: ProfileSessions, registryFor: (agent: Agent) => Promise<SemanticRegistry>, changed: (agent: Agent) => Promise<void>, commands: (agent: Agent) => Promise<CommandBrief[]>, namespace?: NamespaceIntegration): void {
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
            await profiles.load(execution.agent.session, name);
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
            return writeProfile(namespace ?? execution.agent.ctx.get('namespaceIntegration')!, execution.agent, name ?? target, profile, 'save');
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_apply', description: contract('tools_profile_apply').description,
        parameters: { name: { type: 'string', description: contract('tools_profile_apply').parameterDocs!.name }, value: { type: 'object', additionalProperties: true, required: true, description: contract('tools_profile_apply').parameterDocs!.value } },
        output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new ConversationRequiredError();
            const { name, value } = z.strictObject({ name: z.string().optional(), value: z.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a Profile object patch') }).parse(args);
            validateProfilePatch(value);
            return writeProfile(namespace ?? execution.agent.ctx.get('namespaceIntegration')!, execution.agent, name, value as ProfilePatch, 'apply');
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
        execute: async (_args, execution) => execution.agent && !execution.agent.ctx.get('namespaceIntegration')!.isPtc(execution.agent)
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
