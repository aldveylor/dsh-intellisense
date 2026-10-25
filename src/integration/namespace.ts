import { nodePermissions, fixLevel, type CommandContract, type Node, type NodeType, type NodePermissions, type SerializedNode } from './node.js';
export type { Node, NodeType, NodePermissions, SerializedNode } from './node.js';
import { builtinDeclaration, namespaceDeclaration } from './namespace_declaration.js';
import { decodeHTML } from 'entities';
import { z } from 'zod';
import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import { pluginCommands, ptcToolName, type BuiltinTool } from '../runtime/builtins.js';
import type { CommandBinding } from '../runtime/protocol.js';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief YAML aliases reference physical tools and rename argument fields without reimplementing tools. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1), argMap: z.record(z.string(), z.string()).optional() })).superRefine((aliases, context) => {
    const names = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
        const parts = alias.path.split('.');
        if (['console', 'tools', 'globalThis'].includes(parts[0]!) || parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part))) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Reserved alias path' });
        if (names.has(alias.path)) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Duplicate alias path' });
        names.add(alias.path);
    }
});

/** @brief Trusted host-side namespace manifest entry. */
export interface ManifestEntry extends CommandContract { path: string }

/** @brief An ordinary namespace owns direct child references and resolves node chains. */
export class NamespaceNode implements Node {
    readonly type: NodeType = 'namespace';
    private readonly members = new Map<string, NamespaceNode | CommandNode>();

    constructor(readonly name: string, readonly parent: NamespaceNode | undefined = undefined) {}

    get path(): string { return this.parent?.path ? `${this.parent.path}.${this.name}` : this.name; }

    get children(): ReadonlyMap<string, NamespaceNode | CommandNode> { return this.members; }

    get permissions(): NodePermissions { return nodePermissions(this.type, this.path); }

    /** @brief Attach a direct child while preventing callable/namespace and identity collisions. */
    add<T extends NamespaceNode | CommandNode>(node: T): T {
        if (node.parent !== this || !/^[A-Za-z_$][\w$]*$/.test(node.name) || ['__proto__', 'constructor', 'prototype', 'then'].includes(node.name)) throw new Error(`Invalid namespace child: ${node.name}`);
        const previous = this.members.get(node.name);
        if (previous && previous !== node && !(previous instanceof CommandNode && node instanceof CommandNode && previous.tool === node.tool)) throw new Error(`Namespace overlaps an existing node: ${node.path}`);
        this.members.set(node.name, node);
        return node;
    }

    /** @brief Follow direct child references from this namespace. */
    resolve(parts: readonly string[]): NamespaceNode | CommandNode | undefined {
        const [name, ...remaining] = parts;
        if (name === undefined) return this;
        const child = this.children.get(name);
        return remaining.length ? child instanceof NamespaceNode ? child.resolve(remaining) : undefined : child;
    }

    /** @brief Project command leaves only at execution and presentation boundaries. */
    commands(): CommandNode[] {
        return [...this.children.values()].flatMap(node => node instanceof NamespaceNode ? node.commands() : [node]);
    }

    serialize(): SerializedNode { return { type: this.type, name: this.name, permissions: this.permissions, children: [...this.children.values()].map(node => node.serialize()) }; }

    /** @brief Keep JSON consumers from traversing cyclic parent references. */
    toJSON(): SerializedNode { return this.serialize(); }
}

/** @brief Builtin namespace structure cannot be renamed, moved or removed. */
export class InnerNamespaceNode extends NamespaceNode {
    override readonly type: NodeType = 'inner_namespace';

}

/** @brief The anonymous root is the single entry to a resolved namespace tree. */
export class RootNamespaceNode extends NamespaceNode {
    override readonly type: NodeType = 'root_namespace';

    constructor() { super(''); }

}

/** @brief A resolved command owns its parent reference and callable contract. */
export class CommandNode implements Node, ManifestEntry {
    readonly type: NodeType = 'command';
    readonly tool: string;
    readonly argMap?: Record<string, string>;
    readonly schema: Record<string, unknown>;
    readonly output: unknown;
    readonly doc: string;

    constructor(readonly name: string, readonly parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>) {
        this.tool = entry.tool;
        this.argMap = entry.argMap;
        this.schema = entry.schema;
        this.output = entry.output;
        this.doc = entry.doc;
    }

    get path(): string { return this.parent.path ? `${this.parent.path}.${this.name}` : this.name; }

    get permissions(): NodePermissions { return nodePermissions(this.type, this.path); }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions, command: { tool: this.tool, argMap: this.argMap, schema: this.schema, output: this.output, doc: this.doc } });
    }

    /** @brief Keep serialized commands independent of their parent object graph. */
    toJSON(): SerializedNode { return this.serialize(); }

    /** @brief Resolve a requested pin against this command's available levels. */
    fixLevel(level: 0 | 1 | 2 = 0): 0 | 1 | 2 {
        return fixLevel(this.permissions, level);
    }

    /** @brief Compile the physical target and argument/result adapters before installing the VM function. */
    binding(): CommandBinding {
        const fields = parameters(this);
        const result = resultField(this);
        return {
            path: this.path, tool: this.tool,
            parameters: fields ? { kind: 'fields', fields: fields.map(field => field.native) }
                : { kind: 'object', aliases: { ...this.argMap } },
            result: result ? { kind: 'field', field: result[0] } : { kind: 'identity' },
        };
    }

    /** @brief Translate named alias arguments into the native schema. */
    nativeArguments(input: unknown): unknown { return nativeArgumentsFor(this, input); }

    /** @brief Project a native result into the public namespace return value. */
    result(value: unknown): unknown { return resultFor(this, value); }

    /** @brief Render the public positional TypeScript declaration. */
    declaration(nested = true): string { return declaration(this, nested); }
}

/** @brief Builtin commands own their invocation adapters and restricted editing permissions. */
export class InnerCommandNode extends CommandNode {
    override readonly type: NodeType = 'inner_command';

    constructor(name: string, parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, readonly builtin: BuiltinTool) { super(name, parent, entry); }

    /** @brief Identify data-only builtins before installing runtime command functions. */
    get preload(): boolean { return this.builtin.preload ?? false; }

    override binding(): CommandBinding {
        const binding = super.binding();
        if (this.builtin.rest) binding.parameters = { kind: 'rest', field: this.builtin.rest };
        else if (this.builtin.positional) binding.parameters = { kind: 'overloads', layouts: this.builtin.positional.map(layout => [...layout]) };
        if (this.builtin.discardResult) binding.result = { kind: 'discard' };
        return binding;
    }

    override result(value: unknown): unknown { return this.builtin.discardResult ? undefined : super.result(value); }

    override serialize(): SerializedNode { return { ...super.serialize(), builtin: structuredClone(this.builtin) }; }

    override declaration(nested = true): string {
        const contract = this.tool === 'tools_search' ? pluginCommands.searchContract(((this.schema.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? []) : this.builtin;
        return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: builtinDeclaration(contract) }], false);
    }
}

/** @brief Ignore the ambient global namespace prefix and validate discovery paths. */
export function normalizeIntellisenseQueries(queries: readonly string[]): string[] {
    return queries.map(query => {
        const path = query.replace(/^global\./, '');
        if (path !== '' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(path)) throw new Error(`Invalid IntelliSense query: ${query}`);
        return path;
    });
}

/** @brief Add runtime-owned console nodes for PTC discovery and prompt projections. */
export function withRuntimeNodes(root: RootNamespaceNode, disabled: (path: string) => boolean): RootNamespaceNode {
    if (disabled('console') || root.children.has('console')) return root;
    const console = root.add(new InnerNamespaceNode('console', root));
    for (const builtin of pluginCommands.consoleCommands) {
        if (disabled(builtin.path)) continue;
        console.add(new InnerCommandNode(builtin.path.split('.').at(-1)!, console,
            { tool: builtin.path, schema: {}, output: {}, doc: builtin.description }, { ...builtin, tool: builtin.path }));
    }
    return root;
}

/** @brief Select exact commands or direct members by following the node chain. */
export function queryNodes(root: RootNamespaceNode, queries: readonly string[]): (NamespaceNode | CommandNode)[] {
    const selected = new Set<NamespaceNode | CommandNode>();
    for (const query of normalizeIntellisenseQueries(queries)) {
        const path = query.replace(/\.$/, '');
        const node = root.resolve(path ? path.split('.') : []);
        if (node instanceof NamespaceNode) for (const child of node.children.values()) selected.add(child);
        else if (node && !query.endsWith('.')) selected.add(node);
    }
    return [...selected];
}

/** @brief Build deterministic, scoped aliases from the current Profile and physical tool catalog. */
export function manifest(registry: SemanticRegistry, aliases: z.infer<typeof Aliases>): RootNamespaceNode {
    const root = new RootNamespaceNode();
    const managementPaths = Object.fromEntries(pluginCommands.builtinTools.map(command => [command.tool, command.path]));
    const insert = (entry: ManifestEntry): void => {
        if ((entry.path === 'tools' || entry.path.startsWith('tools.') || entry.tool.startsWith('tools_')) && managementPaths[entry.tool] !== entry.path) return;
        if (registry.disabled(entry.path)) return;
        const parts = entry.path.split('.');
        if (parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part)) || ['console', 'globalThis'].includes(parts[0]!)) throw new Error(`Reserved manifest path: ${entry.path}`);
        let parent: NamespaceNode = root;
        for (const name of parts.slice(0, -1)) {
            const existing = parent.children.get(name);
            if (existing && !(existing instanceof NamespaceNode)) throw new Error(`Namespace overlaps a callable path: ${entry.path}`);
            parent = existing ?? parent.add(parts[0] === 'tools' ? new InnerNamespaceNode(name, parent) : new NamespaceNode(name, parent));
        }
        const name = parts.at(-1)!;
        const previous = parent.children.get(name);
        if (previous) {
            if (!(previous instanceof CommandNode) || previous.tool !== entry.tool) throw new Error(`Conflicting tool alias: ${entry.path}`);
        }
        const builtin = pluginCommands.find(entry.tool);
        parent.add(builtin ? new InnerCommandNode(name, parent, entry, builtin) : new CommandNode(name, parent, entry));
    };
    const effective = registry.effective().filter(mapping => !mapping.disabled);
    for (const mapping of effective.filter(mapping => !['exec', 'run_code', ptcToolName].includes(mapping.id))) {
        const physical = mapping.tool;
        const paths = mapping.id.startsWith('tools_') ? [`tools.${mapping.id.slice(6)}`] : [mapping.path, ...mapping.aliases];
        for (const path of paths) insert({ path, tool: mapping.id, schema: physical.parameters, output: physical.output, doc: physical.description });
    }
    const mounted = new Set(effective.map(mapping => mapping.id));
    for (const alias of aliases) {
        const tool = registry.tools().find(tool => tool.id === alias.tool);
        if (tool && mounted.has(tool.id)) insert({ ...alias, schema: tool.parameters, output: tool.output, doc: tool.description });
    }
    for (const [id, path] of Object.entries(managementPaths)) {
        const tool = registry.tools().find(tool => tool.id === id);
        if (tool) insert({ path, tool: tool.id, schema: tool.parameters, output: tool.output, doc: tool.description });
    }
    return root;
}

/** @brief One positional parameter projected from a native object contract. */
interface Parameter { name: string; native: string; schema: JsonSchemaNode; required: boolean }

/** @brief Expand named fields in stable required-first order; keep unconstrained objects as one argument. */
function parameters(entry: ManifestEntry): Parameter[] | undefined {
    if (entry.schema.type !== 'object' || entry.schema.oneOf) return;
    const fields = Object.entries(entry.schema.properties as Record<string, JsonSchemaNode> ?? {});
    if (!fields.length && entry.schema.additionalProperties !== false) return;
    const names = new Map(Object.entries(entry.argMap ?? {}).map(([source, native]) => [native, source]));
    return fields.map(([native, schema]) => ({ name: names.get(native) ?? native, native, schema, required: (entry.schema.required as string[] | undefined)?.includes(native) ?? false }))
        .sort((a, b) => Number(b.required) - Number(a.required));
}

/** @brief Validate named DSML arguments after translating configured alias field names. */
export function nativeArgumentsFor(entry: ManifestEntry, input: unknown): unknown {
    let args = input;
    if (entry.argMap && args && typeof args === 'object' && !Array.isArray(args)) {
        const pairs = Object.entries(args).map(([key, value]) => [entry.argMap![key] ?? key, value]);
        args = Object.fromEntries(pairs);
        if (Object.keys(args as object).length !== pairs.length) throw new Error('Argument mapping contains a duplicate target');
    }
    const errors = validateJsonSchemaValue(entry.schema as JsonSchemaNode, args);
    if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
    return args;
}

/** @brief Project native object schemas onto configured DSML argument names. */
export function nativeSchema(entry: ManifestEntry): Record<string, unknown> {
    const names = new Map(Object.entries(entry.argMap ?? {}).map(([alias, native]) => [native, alias]));
    const schema = structuredClone(entry.schema);
    if (schema.properties && typeof schema.properties === 'object') schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [names.get(key) ?? key, value]));
    if (Array.isArray(schema.required)) schema.required = schema.required.map(key => names.get(key) ?? key);
    return schema;
}

/** @brief Select only unambiguous single-property object results for scalar projection. */
function resultField(entry: ManifestEntry): [string, JsonSchemaNode] | undefined {
    const output = entry.output as JsonSchemaNode | undefined;
    if (!output || output.type !== 'object' || output.oneOf) return;
    const fields = Object.entries(output.properties ?? {});
    return fields.length === 1 ? fields[0] : undefined;
}

/** @brief Unwrap the native response using the same contract exposed by IntelliSense. */
export function resultFor(entry: ManifestEntry, value: unknown): unknown {
    const field = resultField(entry);
    return field && value && typeof value === 'object' ? Object.hasOwn(value, field[0]) ? (value as Record<string, unknown>)[field[0]] : undefined : value;
}

/** @brief Emit positional signatures and scalar results with decoded Doxygen parameter documentation. */
export function declaration(entry: ManifestEntry, nested = true): string {
    if (entry instanceof InnerCommandNode) return entry.declaration(nested);
    return namespaceDeclaration([{ path: nested ? entry.path : entry.path.split('.').at(-1)!, declaration: commandDeclaration(entry) }], false);
}

/** @brief Project one manifest contract into a leaf declaration for the shared namespace tree. */
function commandDeclaration(entry: ManifestEntry): string {
    const name = entry.path.split('.').at(-1)!;
    const doc = (text: string): string => decodeHTML(text).replaceAll('*/', '* /');
    const types: string[] = [];
    /** @brief Keep complex field types out of the callable signature. */
    const typeName = (value: unknown, suffix: string): string => {
        const text = decodeHTML(jsonSchemaToTs(value));
        if (!text.includes('{')) return text;
        const alias = `${name}_${suffix}`;
        types.push(`type ${alias} = ${text};`);
        return alias;
    };
    const fields = parameters(entry);
    const args = fields ? fields.map(field => `${field.name}${field.required ? '' : '?'}: ${typeName(field.schema, field.name)}`).join(', ')
        : `args: ${typeName(entry.schema, 'args')}`;
    const parameterDocs = fields ? fields.map(field => ` * @param ${field.name} ${doc(field.schema.description ?? 'Tool argument')}`).join('\n') : ' * @param args Tool arguments';
    const field = resultField(entry);
    const result = typeName(field?.[1] ?? entry.output, 'result');
    const optionalResult = field && !(entry.output as JsonSchemaNode).required?.includes(field[0]) ? ' | undefined' : '';
    return `${types.length ? types.join('\n') + '\n\n' : ''}/**\n * @brief ${doc(entry.doc)}\n${parameterDocs ? parameterDocs + '\n' : ''} * @returns ${field?.[1].description ? doc(field[1].description) : 'Tool result'}\n */\nfunction ${name}(${args}): Promise<${result}${optionalResult}>;\n`;
}
