import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { declaration, type ManifestEntry } from './namespace.js';
import { builtinCommands } from '../runtime/builtins.js';
import type { NamespaceComponent } from './namespace_component.js';

/** @brief A merged declaration node; an exact query expands a callable's complete signature. */
interface DeclarationNode { children: Map<string, DeclarationNode>; entry?: ManifestEntry; detailed?: boolean; signature?: string; description?: string }

/** @brief Render queried members and signatures as one valid ambient TypeScript namespace tree. */
export function intellisense(queries: readonly string[], entries: readonly ManifestEntry[], runtime = false): string {
    const root: DeclarationNode = { children: new Map() };
    const commands = runtime ? builtinCommands : builtinCommands.filter(command => command.path === 'tools.intellisense');
    /** @brief Merge overlapping queries without repeating declarations. */
    function nodeFor(path: string): DeclarationNode {
        let node = root;
        for (const part of path.split('.').filter(Boolean)) {
            if (!node.children.has(part)) node.children.set(part, { children: new Map() });
            node = node.children.get(part)!;
        }
        return node;
    }
    for (const query of queries) {
        if (query !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(query)) throw new Error(`Invalid IntelliSense query: ${query}`);
        const exact = !query.endsWith('.') && entries.find(entry => entry.path === query);
        const fixed = !query.endsWith('.') && commands.find(command => command.path === query);
        if (exact || fixed) {
            Object.assign(nodeFor(query), { ...(exact ? { entry: exact } : { signature: fixed!.signature, description: fixed!.description }), detailed: true });
            continue;
        }
        const prefix = query ? query.replace(/\.$/, '') + '.' : '';
        nodeFor(prefix.replace(/\.$/, ''));
        for (const command of [...entries, ...commands]) {
            if (!command.path.startsWith(prefix)) continue;
            const name = command.path.slice(prefix.length).split('.')[0]!;
            const path = prefix + name;
            const node = nodeFor(path);
            if (path === command.path) {
                if ('tool' in command) node.entry = command;
                else { node.signature = command.signature; node.description = command.description; }
            }
        }
    }
    const lines = ['declare namespace global {'];
    /** @brief Keep brief documentation on one comment line. */
    const brief = (text: string): string => text.replace(/[\r\n\u2028\u2029]/g, ' ').replaceAll('*/', '* /');
    /** @brief Emit nested namespaces, full signatures and shallow member hints deterministically. */
    function visit(node: DeclarationNode, indent: string): void {
        for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
            if (child.entry || child.signature) {
                if (child.detailed) {
                    const text = child.entry ? declaration({ ...child.entry, path: name }) : `/** @brief ${brief(child.description!)} */\nfunction ${name}${child.signature!.replace(' => ', ': ')};`;
                    lines.push(...text.trim().split('\n').map(line => indent + line));
                } else lines.push(`${indent}const ${name}: Function; // ${brief(child.entry?.doc ?? child.description ?? '')}`);
            } else {
                lines.push(`${indent}namespace ${name} {`);
                visit(child, indent + '    ');
                lines.push(`${indent}}`);
            }
        }
    }
    visit(root, '    ');
    lines.push('}');
    return lines.join('\n');
}

/** @brief Register batched signature discovery as an ordinary guarded native tool. */
export function registerIntellisense(ctx: Context, namespaces: NamespaceComponent): void {
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'tools_intellisense',
        description: 'Query namespace members with a trailing dot, or complete tool signatures by exact path. Returns TypeScript declarations. Call through tools.intellisense.',
        parameters: { queries: { type: 'array', items: { type: 'string' }, required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async ({ queries }, execution) => {
            const agent = execution.agent;
            if (!agent) throw new Error('A live conversation is required');
            execution.signal.throwIfAborted();
            const started = performance.now();
            const info = intellisense(queries, await namespaces.entries(agent), namespaces.isPtc(agent));
            const position = namespaces.position(agent);
            appendPluginRecord(agent.session, 'plugin:ts_intellisense/intellisense', {
                ...position, queries, info, elapsedMs: performance.now() - started,
                profileRevision: (await namespaces.registryFor(agent)).snapshot().revision,
                runtimeEpoch: namespaces.isPtc(agent) ? ctx.get('codeRuntime')?.epoch(agent.id) ?? 0 : 0,
            });
            return info;
        },
    })));
}
