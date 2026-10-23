import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { builtinCommands, defaultBuiltinVisible } from '../runtime/builtins.js';
import { validatePath } from '../registry/path.js';

/** @brief Register independent, session-local tool editing commands and explicit profile publication. */
export function registerToolCommands(ctx: Context, catalog: SemanticRegistry, profiles: ProfileSessions, registryFor: (agent: Agent) => Promise<SemanticRegistry>, changed: (agent: Agent) => Promise<void>): void {
    const queues = new Map<string, Promise<unknown>>();
    /** @brief Serialize concurrent VM management calls against the same conversation draft. */
    const register = (definition: Parameters<typeof ctx.tools.register>[0]) => ctx.tools.register({
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
    /** @brief Resolve a visible physical identity or mounted/tools path without accepting stale tools. */
    const resolve = (registry: SemanticRegistry, source: string) => {
        const mapping = registry.effective().find(tool => tool.path === source || tool.aliases.includes(source)) ?? registry.effective().find(tool => tool.id === source);
        if (!mapping) throw new Error(`Unknown tool: ${source}`);
        return mapping;
    };
    /** @brief Keep tool outputs native JSON values with their ordinary text rendering. */
    const output = { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, path: { type: 'string' }, changed: { type: 'boolean' }, comment: { type: 'string' }, fixed: { type: 'integer', enum: [0, 1, 2] }, profile: { type: 'string' }, saved: { type: 'boolean' }, loaded: { type: 'boolean' }, current: { type: 'string' }, profiles: { type: 'array', items: { type: 'string' } } } } as const, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
    register(defineTool({
        name: 'tools_mount', description: 'Mount a tool under node.name in this conversation. source accepts a physical ID or current path. An already mounted source keeps its path as an alias; tools is replaced automatically. Use node="" for the root. Changes are drafts until tools_commit.',
        parameters: { source: { type: 'string', required: true }, node: { type: 'string', required: true }, name: { type: 'string' } }, output,
        execute: async ({ source, node, name }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            const tool = resolve(registry, source);
            const leaf = name ?? (tool.aliases.includes(source) ? source : tool.path).split('.').at(-1)!;
            if (!/^[a-zA-Z_$][\w$]*$/.test(leaf)) throw new Error('Invalid mount name');
            const path = node ? `${node}.${leaf}` : leaf;
            validatePath(path);
            if (path === 'tools' || path.startsWith('tools.')) throw new Error('Cannot mount under tools');
            const state = registry.snapshot();
            const old = state.mappings.find(mapping => mapping.id === tool.id);
            const mappings = old ? state.mappings.map(mapping => mapping.id !== tool.id || mapping.path === path || mapping.aliases.includes(path) ? mapping : { ...mapping, aliases: [...mapping.aliases, path] }) :
                [...state.mappings, { id: tool.id, path, aliases: [], enabled: true, pinned: false, alwaysVisible: tool.alwaysVisible }];
            await registry.configure(mappings, state.revision);
            await changed(execution.agent);
            return { id: tool.id, path };
        },
    }));
    register(defineTool({
        name: 'tools_unmount', description: 'Remove one mounted target path from this conversation. Other aliases remain. tools paths are unchanged. Save with tools_commit.',
        parameters: { target: { type: 'string', required: true } }, output,
        execute: async ({ target }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            if (target === 'tools' || target.startsWith('tools.')) return { changed: false };
            const state = registry.snapshot();
            const mappings = state.mappings.flatMap(mapping => {
                if (mapping.path === target) return mapping.aliases.length ? [{ ...mapping, path: mapping.aliases[0]!, aliases: mapping.aliases.slice(1) }] : [];
                return [{ ...mapping, aliases: mapping.aliases.filter(path => path !== target) }];
            });
            if (JSON.stringify(mappings) === JSON.stringify(state.mappings)) return { changed: false };
            await registry.configure(mappings, state.revision);
            await changed(execution.agent);
            return { changed: true };
        },
    }));
    register(defineTool({
        name: 'tools_comment', description: 'Set a simplified prompt comment for any tool by physical ID or path, including unmounted tools. Original IntelliSense documentation is preserved. Save with tools_commit.',
        parameters: { tool: { type: 'string', required: true }, comment: { type: 'string', required: true } }, output,
        execute: async ({ tool: source, comment }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            const tool = resolve(registry, source);
            const state = registry.snapshot();
            await registry.configure(state.mappings, state.revision, undefined, undefined, undefined, undefined, { ...state.toolComments, [tool.id]: comment });
            await changed(execution.agent);
            return { id: tool.id, comment };
        },
    }));
    register(defineTool({
        name: 'tools_fix', description: 'Set command prompt exposure in this conversation: 0 hides it, 1 pins its brief, and 2 pins its full signature and documentation. Accepts physical IDs and mounted/tools paths. Save with tools_commit.',
        parameters: { tool: { type: 'string', required: true }, fixed: { type: 'integer', enum: [0, 1, 2] } }, output,
        execute: async ({ tool: source, fixed = 1 }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            const state = registry.snapshot();
            if (![0, 1, 2].includes(fixed)) throw new Error('Invalid command pin level');
            const level = fixed as 0 | 1 | 2;
            if (source === 'tools.intellisense' || source === 'tools_intellisense') { source = 'tools.intellisense'; fixed = level || 1; }
            if (builtinCommands.some(command => command.path === source)) {
                const visible = { ...(state.builtinVisible ?? defaultBuiltinVisible) };
                visible[source] = fixed as 0 | 1 | 2;
                await registry.configure(state.mappings, state.revision, undefined, undefined, undefined, undefined, undefined, visible);
                await changed(execution.agent);
                return { id: source, fixed };
            }
            const tool = resolve(registry, source);
            const toolsVisible = { ...state.unmountedVisible };
            delete toolsVisible[tool.id];
            if (fixed && !state.mappings.some(mapping => mapping.id === tool.id)) toolsVisible[tool.id] = level;
            await registry.configure(state.mappings.map(mapping => mapping.id === tool.id ? { ...mapping, alwaysVisible: level } : mapping), state.revision, undefined, undefined, toolsVisible);
            await changed(execution.agent);
            return { id: tool.id, fixed };
        },
    }));
    register(defineTool({
        name: 'tools_commit', description: 'Save this conversation draft into the explicitly named profile, replacing that catalog entry if it exists. Existing conversations keep their own versions. This conversation uses the committed version immediately.',
        parameters: { profile: { type: 'string', required: true } }, output,
        execute: async ({ profile }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            await profiles.commit(execution.agent.id, profile);
            await changed(execution.agent);
            return { profile, saved: true };
        },
    }));
    register(defineTool({
        name: 'tools_profiles', description: 'List profile names currently visible in the catalog and this conversation reference. Deleted entries can remain referenced by existing conversations.',
        parameters: {}, output,
        execute: async (_args, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            const registry = await registryFor(execution.agent);
            return { profiles: catalog.snapshot().profiles ?? [], current: registry.snapshot().profile };
        },
    }));
    register(defineTool({
        name: 'tools_loadprofile', description: 'Immediately switch only this conversation to the latest named profile version and inject its current context. Existing conversation history and other conversations are unchanged.',
        parameters: { profile: { type: 'string', required: true } }, output,
        execute: async ({ profile }, execution) => {
            if (!execution.agent) throw new Error('A live conversation is required');
            await profiles.load(execution.agent.id, profile);
            await changed(execution.agent);
            return { profile, loaded: true };
        },
    }));
}
