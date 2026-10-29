import type { ProfileSnapshot } from '../registry/profile/profile.js';
import type { ProfileNode } from '../registry/profile/node.js';
import type { ProfileCommand } from '../registry/profile/command.js';
import type { ProfileNamespace } from '../registry/profile/namespace.js';
import type { PresentationMode } from '../integration/presentation.js';
import type { ToolAdditions } from '../integration/tool_additions/tool_additions.js';
import type { PhysicalTool } from '../registry/registry.js';
import type { CommandContract, SerializedNode } from './node.js';
import type { CommandBinding } from '../runtime/protocol.js';
import { namespaceDeclaration, callableDeclaration } from './declaration.js';
import { commandDeclaration, parameters, resultField } from './command_contract/command_contract.js';
import { z } from 'zod';
export { nativeArgumentsFor, resultFor } from './command_contract/command_contract.js';
export type { Node, NodeType, Permission, SerializedNode } from './node.js';

/** @brief YAML aliases mount physical tools at additional namespace paths. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1) })).superRefine((aliases, context) => {
    const names = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
        const parts = alias.path.split('.');
        if (['console', 'tools', 'globalThis'].includes(parts[0]!) || parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part))) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Reserved alias path' });
        if (names.has(alias.path)) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Duplicate alias path' });
        names.add(alias.path);
    }
});

/** @brief Flat output contract for a physical tool at one Profile path. */
export interface ManifestEntry extends CommandContract { path: string }

/** @brief A derived command contract retaining its original Profile node, without a second node hierarchy. */
export interface CommandEntry extends ManifestEntry {
    node: ProfileCommand;
    name: string;
    fixedLevel: 0 | 1 | 2;
    provided: boolean;
    preload: boolean;
    signature?: string;
}

/** @brief One original node and its path while walking a Profile. */
export interface ProfileMember { path: string; node: ProfileNode }

/** @brief Walk original nodes; disabled containers exclude their entire subtree by default. */
export function* profileMembers(root: ProfileNamespace, enabled = true, parent = ''): Generator<ProfileMember> {
    if (enabled && root.disabled) return;
    for (const [name, node] of root.children) {
        if (enabled && node.disabled) continue;
        const path = parent ? `${parent}.${name}` : name;
        yield { path, node };
        if (node.type === 'namespace') yield* profileMembers(node as ProfileNamespace, enabled, path);
    }
}

/** @brief Supplement original commands with scoped physical contracts only at a consumer boundary. */
export function commandEntries(profile: ProfileSnapshot, tools: readonly PhysicalTool[], mode: PresentationMode, additions: ToolAdditions): CommandEntry[] {
    const byTool = new Map(tools.map(tool => [tool.id, tool]));
    const members = [...profileMembers(profile)];
    const discovery = members.some(({ node }) => node.type === 'command' && (node as ProfileCommand).discovery
        && byTool.has((node as ProfileCommand).tool!) && !additions.get((node as ProfileCommand).tool!).hidden);
    return members.flatMap(({ path, node }) => {
        if (node.type !== 'command') return [];
        const command = node as ProfileCommand;
        const tool = byTool.get(command.tool!);
        const addition = additions.get(command.tool!);
        if (!tool || addition.hidden) return [];
        const presentation = command.presentation?.(tool.parameters, mode, discovery);
        const doc = (mode === 'ptc' ? addition.ptcDescription : undefined) ?? presentation?.description ?? tool.description;
        return [{ path, node: command, name: path.split('.').at(-1)!, tool: tool.id, schema: tool.parameters, output: tool.output, doc, presentation,
            fixedLevel: command.serialize().fixedLevel ?? 0, provided: !command.permissions.removable,
            preload: presentation?.preload ?? false, signature: presentation?.signature }];
    });
}

/** @brief Ignore the ambient global namespace prefix and validate discovery paths. */
export function normalizeInspectQueries(queries: readonly string[]): string[] {
    return queries.map(query => {
        const path = query.replace(/^global\./, '');
        if (path !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(path)) throw new Error(`Invalid Inspect query: ${query}`);
        return path;
    });
}

/** @brief Resolve exact commands or direct namespace members using the snapshot's own node identities. */
export function queryNodes(profile: ProfileSnapshot, queries: readonly string[]): ProfileMember[] {
    const selected = new Map<string, ProfileNode>();
    for (const query of normalizeInspectQueries(queries)) {
        const path = query.replace(/\.$/, '');
        const node = profile.resolve(path);
        if (node?.type === 'namespace') {
            for (const [name, child] of (node as ProfileNamespace).children) {
                if (!child.disabled) selected.set(path ? `${path}.${name}` : name, child);
            }
        } else if (node?.type === 'command' && !query.endsWith('.')) selected.set(path, node);
    }
    return [...selected].map(([path, node]) => ({ path, node }));
}

/** @brief Compile one flat contract into the data understood by the isolated VM. */
export function bindingFor(entry: CommandEntry): CommandBinding {
    const fields = parameters(entry);
    const result = resultField(entry);
    return { path: entry.path, tool: entry.tool,
        parameters: entry.presentation?.positional ? { kind: 'overloads', layouts: entry.presentation.positional.map(layout => [...layout]) }
            : fields ? { kind: 'fields', fields: fields.map(field => field.name) } : { kind: 'object' },
        result: entry.presentation?.discardResult ? { kind: 'discard' } : result ? { kind: 'field', field: result[0] } : { kind: 'identity' } };
}

/** @brief Render an individual command without constructing namespace node objects. */
export function declaration(entry: ManifestEntry, nested = true): string {
    return namespaceDeclaration([{ path: nested ? entry.path : entry.path.split('.').at(-1)!, declaration: entry.presentation
        ? callableDeclaration({ ...entry.presentation, path: entry.path, description: entry.doc }) : commandDeclaration(entry) }], false);
}

/** @brief Export browser transport data directly from Profile nodes; no semantic tree is constructed. */
export function serializeProfile(profile: ProfileSnapshot, tools: readonly PhysicalTool[], mode: PresentationMode, additions: ToolAdditions): SerializedNode {
    const entries = new Map(commandEntries(profile, tools, mode, additions).map(entry => [entry.path, entry]));
    const visit = (node: ProfileNode, name: string, path: string): SerializedNode => {
        const data = node.serialize();
        if (node.type === 'namespace') return { type: 'tree', name, permissions: node.permissions, description: data.description,
            disabled: node.disabled, fixedLevel: data.fixedLevel as 0 | 1, children: [...(node as ProfileNamespace).children].map(([name, child]) => visit(child, name, path ? `${path}.${name}` : name)) };
        const entry = entries.get(path);
        return { type: 'leaf', name, permissions: node.permissions, disabled: node.disabled, fixedLevel: data.fixedLevel as 0 | 1 | 2,
            description: entry?.doc ?? data.command?.doc, preload: entry?.preload,
            command: entry ? { tool: entry.tool, schema: entry.schema, output: entry.output, doc: entry.doc, presentation: entry.presentation } : { tool: (node as ProfileCommand).tool!, schema: {}, doc: data.command?.doc ?? '' } };
    };
    return visit(profile, '', '');
}
