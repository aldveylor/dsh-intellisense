import { builtinDeclaration, namespaceDeclaration, type NamespaceDeclaration } from './namespace_declaration.js';
import { registerBuiltin } from './builtin_trace.js';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { codeBlock } from '../protocol/code_block.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, normalizeIntellisenseQueries, type ManifestEntry } from './namespace.js';
import { builtinCommands, profileValues } from '../runtime/builtins.js';
import { profileAnnotation } from '../registry/profile_tree.js';
import type { NamespaceComponent } from './namespace_component.js';

/** @brief Render queried members and signatures through the shared namespace declaration model. */
export function intellisense(queries: readonly string[], entries: readonly ManifestEntry[], runtime = false, disabled: (path: string) => boolean = () => false): string {
    const selected = new Map<string, NamespaceDeclaration>();
    const commands = builtinCommands.filter(command => !disabled(command.path) && (runtime || command.path.startsWith('tools.')));
    entries = entries.filter(entry => !disabled(entry.path));
    const values = profileValues.filter(item => !disabled(item.path));
    const visibleEntries = runtime ? entries.filter(entry => !['tools_profile_annotation', 'tools_profile_commands'].includes(entry.tool)) : entries;
    /** @brief Keep exact contracts when a later overlapping query requests shallow members. */
    function insert(item: NamespaceDeclaration): void {
        const previous = selected.get(item.path);
        selected.set(item.path, { ...item, ...previous, ...(previous?.declaration || previous?.valueType ? { namespace: false } : {}) });
    }
    for (const query of normalizeIntellisenseQueries(queries)) {
        const value = runtime ? values.find(item => item.path === query) : undefined;
        if (value) { selected.set(query, { path: query, valueType: value.signature, description: value.description }); continue; }
        const exact = query.endsWith('.') ? undefined : visibleEntries.find(entry => entry.path === query);
        const fixed = query.endsWith('.') ? undefined : commands.find(command => command.path === query);
        if (exact || fixed) {
            selected.set(query, { path: query, declaration: exact ? declaration(exact, false) : builtinDeclaration(fixed!) });
            continue;
        }
        const prefix = query ? query.replace(/\.$/, '') + '.' : '';
        if (prefix) insert({ path: prefix.slice(0, -1), namespace: true });
        for (const command of [...visibleEntries, ...commands, ...(runtime ? values : [])]) {
            if (!command.path.startsWith(prefix)) continue;
            const path = prefix + command.path.slice(prefix.length).split('.')[0]!;
            insert(path !== command.path ? { path, namespace: true } : {
                path, description: 'tool' in command ? command.doc : command.description,
                ...(runtime && values.some(item => item.path === path) && 'signature' in command ? { valueType: command.signature } : {}),
            });
        }
    }
    return profileAnnotation + '\n\n' + namespaceDeclaration([...selected.values()]);
}

/** @brief Register batched signature discovery as an ordinary guarded native tool. */
export function registerIntellisense(ctx: Context, namespaces: NamespaceComponent): void {
    const definition: ToolDefinition = defineTool({
        name: 'tools_intellisense',
        description: 'Query namespace members with a trailing dot, or complete tool signatures by exact path. An empty string ("") in queries lists root namespace members, e.g. {"queries":[""]}. Discovers commands progressively. Call through tools.intellisense.',
        parameters: { queries: { type: 'array', items: { type: 'string' }, description: 'Namespace member paths or exact command paths. An optional global. prefix is ignored. Include an empty string ("") to list root namespace members, e.g. [""].', required: true } },
        output: { schema: { type: 'string', description: 'TypeScript namespace declarations in PTC mode, or a JSON object containing namespace members and exact tool contracts in native mode.' }, render: (_args, value) => [{ type: 'text', text: value }] },
        presentCall: ({ queries }) => ({ card: 'generic', title: 'tools.intellisense', kind: 'read', rawInput: queries }),
        presentResult: (_args, result) => {
            const schema = JSON.stringify({ name: definition.name, description: definition.description, parameters: definition.parameters, output: definition.output.schema }, null, 2);
            const content = result.content.map(block => block.type === 'text'
                ? { type: 'text' as const, text: codeBlock(block.text, result.isError ? 'text' : block.text.trimStart().startsWith('{') ? 'json' : 'typescript') }
                : block);
            return { card: 'generic', content: [{ type: 'text', text: `Schema\n\n${codeBlock(schema, 'json')}\n\nResult` }, ...content] };
        },
        execute: async ({ queries }, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const started = performance.now();
            const registry = await namespaces.registryFor(agent);
            const info = namespaces.isPtc(agent)
                ? intellisense(queries, await namespaces.entries(agent), true, path => registry.disabled(path))
                : await namespaces.discover(agent, queries);
            const position = namespaces.position(agent);
            appendPluginRecord(agent.session, 'plugin:ts_intellisense/intellisense', {
                ...position, queries, info, elapsedMs: performance.now() - started,
                profileRevision: (await namespaces.registryFor(agent)).snapshot().revision,
                runtimeEpoch: namespaces.isPtc(agent) ? agent.ctx.get('codeRuntime')?.epoch(agent.id) ?? 0 : 0,
            });
            return info;
        },
    });
    ctx.effect(() => registerBuiltin(ctx, definition));
}
