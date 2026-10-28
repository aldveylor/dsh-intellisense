import { profileSaveInformation } from './profile_save.js';
import { presentationConfigFor } from '../integration/presentation.js';
import { registerBuiltin } from './builtin_trace.js';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { type CommandBrief, ProfileSchema, profileConfiguration, profileTree, profileAnnotation } from '../registry/profile_tree.js';

/** @brief Register Profile management commands and data access. */
export function registerToolCommands(ctx: Context, catalog: SemanticRegistry, profiles: ProfileSessions, registryFor: (agent: Agent) => Promise<SemanticRegistry>, changed: (agent: Agent) => Promise<void>, commands: (agent: Agent) => Promise<CommandBrief[]>): void {
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
        name: 'tools_profile_load', description: 'Read a named catalog Profile as JSON data without changing this conversation. With no name, return the current draft. Omitted permissions use ordinary node defaults: commentable/renamable/movable/removable/disableable true; acceptsChildren true for namespaces, false for commands; availableFixLevels [0,1] for namespaces, [0,1,2] for commands. Only nondefault permission fields are returned; fixedLevel defaults to 0 and disabled to false, both omitted at defaults.',
        parameters: { name: { type: 'string' } }, output,
        execute: async ({ name }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = name === undefined ? await registryFor(execution.agent) : catalog;
            return JSON.parse(JSON.stringify(profileTree(name ?? registry.snapshot().profile!, registry.configuration(name)))) as Record<string, z.infer<ReturnType<typeof z.json>>>;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_switch', description: 'Switch this conversation to a named catalog Profile.',
        parameters: { name: { type: 'string', required: true, description: 'Existing catalog Profile to select for this conversation.' } },
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
        name: 'tools_profile_setdefault', description: 'Set an existing catalog Profile as the global default for new conversations. Existing conversations keep their working configurations.',
        parameters: { name: { type: 'string', required: true, description: 'Existing catalog Profile to use by default for new conversations.' } },
        output: { ...output, schema: { type: 'null' } },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name } = z.strictObject({ name: z.string().min(1) }).parse(args);
            await catalog.manageProfile('select', name, catalog.snapshot().revision);
            return null;
        },
    })));
    ctx.effect(() => register(defineTool({
        name: 'tools_profile_save', description: 'Replace the catalog Profile tree, recursively restoring missing protected builtin commands and namespaces while preserving supplied settings. The tools namespace is protected and defaults to disabled on save; explicitly set its disabled field to false to enable it. Omitted or undefined name uses the current conversation Profile name, ignoring profile.name. Call tools.profile.switch(name) to apply the saved Profile. When inspect is unavailable, including when tools is disabled, namespace members cannot be discovered; all other commands should be fixed at level 2 or disabled. This is advisory and does not block saving or change pin levels. Returns null on success without information, otherwise an informational string.',
        parameters: { name: { type: 'string', description: 'Target catalog name; defaults to the current conversation Profile name.' }, profile: { type: 'object', additionalProperties: true, required: true, description: 'Editable Profile tree. Missing protected nodes are restored recursively; tools defaults to disabled unless its node explicitly sets disabled: false. Other supplied settings are preserved.' } }, output: { ...output, schema: { oneOf: [{ type: 'string' }, { type: 'null' }] }, render: (_args, value) => [{ type: 'text', text: value ?? '' }] },
        execute: async (args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const { name, profile } = z.strictObject({ name: z.string().optional(), profile: ProfileSchema }).parse(args);
            const registry = await registryFor(execution.agent);
            const target = name ?? registry.snapshot().profile!;
            const original = catalog.snapshot().profiles?.includes(target) ? catalog.configuration(target) : registry.configuration();
            let completed = false;
            const configuration = profileConfiguration(profile, original, await commands(execution.agent), () => { completed = true; });
            if (profile.root.children?.find(node => node.name === 'tools')?.disabled !== false
                && !configuration.builtinDisabled.includes('tools')) configuration.builtinDisabled.push('tools');
            const information = profileSaveInformation(profileTree(target, configuration), registry.tools().map(tool => tool.id), completed);
            await catalog.saveProfile(target, configuration);
            return information;
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
        name: 'tools_profile_commands', description: 'All catalog commands excluding plugin builtins, with physical names, summaries, mount paths in this conversation Profile (including disabled paths; empty when unmounted), and total calls across all sessions. tools.inspect cannot retrieve information by physical command name; query an enabled mount path available in the current conversation instead.', parameters: {},
        output: { ...output, schema: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            return (await commands(execution.agent)).map(({ name, brief, paths, totalCalls }) => ({ name, brief, paths, totalCalls }));
        },
    })));
}
