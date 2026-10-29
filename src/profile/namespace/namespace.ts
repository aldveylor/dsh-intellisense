import type { ProfileSnapshot } from '../profile.js';
import type { ProfileNode } from '../node.js';
import type { ProfileFunction } from '../function.js';
import type { ProfileNamespace } from '../namespace.js';
import type { PresentationMode } from '../../integration/presentation.js';
import type { ToolAdditions } from '../../integration/tool_additions/tool_additions.js';
import type { PhysicalTool } from '../catalog/registry.js';
import type { FunctionContract, SerializedNode } from './node.js';
import type { CommandBinding } from '../../runtime/protocol.js';
import { namespaceDeclaration, callableDeclaration } from './declaration.js';
import { functionDeclaration, parameters, resultField } from './function_contract/function_contract.js';
import { z } from 'zod';
export { nativeArgumentsFor, resultFor } from './function_contract/function_contract.js';
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
export interface ManifestEntry extends FunctionContract { path: string }

/** @brief A derived function contract retaining its original Profile node, without a second node hierarchy. */
export interface FunctionEntry extends ManifestEntry {
    node: ProfileFunction;
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

/** @brief Supplement original functions with scoped physical contracts only at a consumer boundary. */
export function functionEntries(profile: ProfileSnapshot, tools: readonly PhysicalTool[], mode: PresentationMode, additions: ToolAdditions): FunctionEntry[] {
    const byTool = new Map(tools.map(tool => [tool.id, tool]));
    const members = [...profileMembers(profile)];
    const discovery = members.some(({ node }) => node.type === 'function' && (node as ProfileFunction).discovery
        && byTool.has((node as ProfileFunction).tool!) && !additions.get((node as ProfileFunction).tool!).hidden);
    return members.flatMap(({ path, node }) => {
        if (node.type !== 'function') return [];
        const command = node as ProfileFunction;
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

/** @brief Resolve exact functions or direct namespace members using the snapshot's own node identities. */
export function queryNodes(profile: ProfileSnapshot, queries: readonly string[]): ProfileMember[] {
    const selected = new Map<string, ProfileNode>();
    for (const query of normalizeInspectQueries(queries)) {
        const path = query.replace(/\.$/, '');
        const node = profile.resolve(path);
        if (node?.type === 'namespace') {
            for (const [name, child] of (node as ProfileNamespace).children) {
                if (!child.disabled) selected.set(path ? `${path}.${name}` : name, child);
            }
        } else if (node?.type === 'function' && !query.endsWith('.')) selected.set(path, node);
    }
    return [...selected].map(([path, node]) => ({ path, node }));
}

/** @brief Compile one flat contract into the data understood by the isolated VM. */
export function bindingFor(entry: FunctionEntry): CommandBinding {
    const fields = parameters(entry);
    const result = resultField(entry);
    return { path: entry.path, tool: entry.tool,
        parameters: entry.presentation?.positional ? { kind: 'overloads', layouts: entry.presentation.positional.map(layout => [...layout]) }
            : fields ? { kind: 'fields', fields: fields.map(field => field.name) } : { kind: 'object' },
        result: entry.presentation?.discardResult ? { kind: 'discard' } : result ? { kind: 'field', field: result[0] } : { kind: 'identity' } };
}

/** @brief Render an individual function without constructing namespace node objects. */
export function declaration(entry: ManifestEntry, nested = true): string {
    return namespaceDeclaration([{ path: nested ? entry.path : entry.path.split('.').at(-1)!, declaration: entry.presentation
        ? callableDeclaration({ ...entry.presentation, path: entry.path, description: entry.doc }) : functionDeclaration(entry) }], false);
}

/** @brief Export browser transport data directly from Profile nodes; no semantic tree is constructed. */
export function serializeProfile(profile: ProfileSnapshot, tools: readonly PhysicalTool[], mode: PresentationMode, additions: ToolAdditions): SerializedNode {
    const entries = new Map(functionEntries(profile, tools, mode, additions).map(entry => [entry.path, entry]));
    const visit = (node: ProfileNode, name: string, path: string): SerializedNode => {
        const data = node.serialize();
        if (node.type === 'namespace') return { type: 'tree', name, permissions: node.permissions, description: data.description,
            disabled: node.disabled, fixedLevel: data.fixedLevel as 0 | 1, children: [...(node as ProfileNamespace).children].map(([name, child]) => visit(child, name, path ? `${path}.${name}` : name)) };
        const entry = entries.get(path);
        return { type: 'leaf', name, permissions: node.permissions, disabled: node.disabled, fixedLevel: data.fixedLevel as 0 | 1 | 2,
            description: entry?.doc ?? data.function?.doc, preload: entry?.preload,
            function: entry ? { tool: entry.tool, schema: entry.schema, output: entry.output, doc: entry.doc, presentation: entry.presentation } : { tool: (node as ProfileFunction).tool!, schema: {}, doc: data.function?.doc ?? '' } };
    };
    return visit(profile, '', '');
}
