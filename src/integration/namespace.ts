import { decodeHTML } from 'entities';
import { z } from 'zod';
import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief YAML aliases reference physical tools and rename argument fields without reimplementing tools. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1), argMap: z.record(z.string(), z.string()).optional() })).superRefine((aliases, context) => {
    const names = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
        const parts = alias.path.split('.');
        if (['console', 'vm', 'tools', 'globalThis'].includes(parts[0]!) || parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part))) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Reserved alias path' });
        if (names.has(alias.path)) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Duplicate alias path' });
        names.add(alias.path);
    }
});

/** @brief Trusted host-side namespace manifest entry. */
export interface ManifestEntry { path: string; tool: string; argMap?: Record<string, string>; schema: Record<string, unknown>; output: unknown; doc: string }

/** @brief Build deterministic, scoped aliases from the current Profile and physical tool catalog. */
export function manifest(registry: SemanticRegistry, aliases: z.infer<typeof Aliases>): ManifestEntry[] {
    const entries = new Map<string, ManifestEntry>();
    const insert = (entry: ManifestEntry): void => {
        if ((entry.path === 'tools' || entry.path.startsWith('tools.') || entry.tool.startsWith('tools_')) && !(entry.path === 'tools.intellisense' && entry.tool === 'tools_intellisense')) return;
        const parts = entry.path.split('.');
        if (parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part)) || ['console', 'vm', 'globalThis'].includes(parts[0]!)) throw new Error(`Reserved manifest path: ${entry.path}`);
        const previous = entries.get(entry.path);
        if (previous && previous.tool !== entry.tool) throw new Error(`Conflicting tool alias: ${entry.path}`);
        for (const path of entries.keys()) if (path.startsWith(entry.path + '.') || entry.path.startsWith(path + '.')) throw new Error(`Namespace overlaps a callable path: ${entry.path}`);
        entries.set(entry.path, entry);
    };
    for (const mapping of registry.effective().filter(mapping => mapping.enabled && !['exec', 'run_code'].includes(mapping.id))) {
        const physical = mapping.tool;
        const paths = mapping.id.startsWith('tools_') ? [`tools.${mapping.id.slice(6)}`] : [mapping.path, ...mapping.aliases];
        for (const path of paths) insert({ path, tool: mapping.id, schema: physical.parameters, output: physical.output, doc: physical.description });
    }
    const enabled = new Set(registry.effective().filter(mapping => mapping.enabled).map(mapping => mapping.id));
    for (const alias of aliases) {
        const tool = registry.tools().find(tool => tool.id === alias.tool);
        if (tool && enabled.has(tool.id)) insert({ ...alias, schema: tool.parameters, output: tool.output, doc: tool.description });
    }
    const discovery = registry.tools().find(tool => tool.id === 'tools_intellisense');
    if (discovery) insert({ path: 'tools.intellisense', tool: discovery.id, schema: discovery.parameters, output: discovery.output, doc: discovery.description });
    return [...entries.values()];
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

/** @brief Repack positional values into validated native arguments before guarded dispatch. */
export function argumentsFor(entry: ManifestEntry, values: unknown): unknown {
    if (!Array.isArray(values)) throw new Error('Expected positional arguments');
    if (entry.tool === 'tools_intellisense') return nativeArgumentsFor(entry, { queries: values.length === 1 && Array.isArray(values[0]) ? values[0] : values });
    const fields = parameters(entry);
    let args: unknown;
    if (fields) {
        if (values.length > fields.length) throw new Error('Too many arguments');
        args = Object.fromEntries(fields.flatMap((field, index) => values[index] === undefined ? [] : [[field.native, values[index]]]));
    } else {
        if (values.length > 1) throw new Error('Too many arguments');
        args = values[0] === undefined ? {} : values[0];
        if (entry.argMap && args && typeof args === 'object' && !Array.isArray(args)) {
            const input = args;
            args = Object.fromEntries(Object.entries(input).map(([key, value]) => [entry.argMap![key] ?? key, value]));
            if (Object.keys(args as object).length !== Object.keys(input).length) throw new Error('Argument mapping contains a duplicate target');
        }
    }
    return nativeArgumentsFor({ ...entry, argMap: undefined }, args);
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
    const parts = entry.path.split('.');
    const name = parts.pop()!;
    if (!nested) parts.length = 0;
    if (entry.tool === 'tools_intellisense') return `${parts.length ? `namespace ${parts.join('.')} {\n` : ''}/**\n * @brief Query namespace members and tool signatures.\n * @param queries Namespace member paths or exact command paths.\n * @returns Complete TypeScript declarations for the requested paths.\n */\nfunction ${name}(...queries: string[]): Promise<string>;\n${parts.length ? '}' : ''}`;
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
    return `${parts.length ? `namespace ${parts.join('.')} {\n` : ''}${types.length ? types.join('\n') + '\n\n' : ''}/**\n * @brief ${doc(entry.doc)}\n${parameterDocs ? parameterDocs + '\n' : ''} * @returns ${field?.[1].description ? doc(field[1].description) : 'Tool result'}\n */\nfunction ${name}(${args}): Promise<${result}${optionalResult}>;\n${parts.length ? '}' : ''}`;
}
