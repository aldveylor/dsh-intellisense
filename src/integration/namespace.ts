import { z } from 'zod';
import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import type { SemanticRegistry } from '../registry/registry.js';

/** @brief YAML aliases reference physical tools and rename argument fields without reimplementing tools. */
export const Aliases = z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/), tool: z.string().min(1), argMap: z.record(z.string(), z.string()).optional() })).superRefine((aliases, context) => {
    const names = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
        const parts = alias.path.split('.');
        if (['console', 'vm', 'globalThis'].includes(parts[0]!) || parts.some(part => ['__proto__', 'constructor', 'prototype', 'then'].includes(part))) context.addIssue({ code: 'custom', path: [index, 'path'], message: 'Reserved alias path' });
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
        if (entry.path === 'tools' || entry.path.startsWith('tools.') || entry.tool.startsWith('tools_')) return;
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
    return [...entries.values()];
}

/** @brief Validate translated arguments before entering the native policy and execution pipeline. */
export function argumentsFor(entry: ManifestEntry, value: unknown): unknown {
    let args = value;
    if (entry.argMap) {
        const input = z.record(z.string(), z.json()).parse(value);
        args = Object.fromEntries(Object.entries(input).map(([key, item]) => [entry.argMap![key] ?? key, item]));
        if (Object.keys(args as object).length !== Object.keys(input).length) throw new Error('Argument mapping contains a duplicate target');
    }
    const errors = validateJsonSchemaValue(entry.schema as JsonSchemaNode, args);
    if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
    return args;
}

/** @brief Detailed IntelliSense declarations use TypeScript namespace syntax and Doxygen documentation. */
export function declaration(entry: ManifestEntry): string {
    const parts = entry.path.split('.');
    const name = parts.pop()!;
    const doc = entry.doc.replaceAll('*/', '* /');
    const reverse = new Map(Object.entries(entry.argMap ?? {}).map(([source, target]) => [target, source]));
    const schema = { ...entry.schema };
    if (entry.argMap) {
        if (schema.properties) schema.properties = Object.fromEntries(Object.entries(schema.properties as object).map(([name, value]) => [reverse.get(name) ?? name, value]));
        if (Array.isArray(schema.required)) schema.required = schema.required.map(name => reverse.get(name) ?? name);
    }
    const types: string[] = [];
    /** @brief Name object contracts so the call signature stays compact without changing the native API. */
    const typeName = (value: unknown, suffix: string): string => {
        const text = jsonSchemaToTs(value);
        if (!text.includes('{')) return text;
        const alias = `${name}_${suffix}`;
        types.push(`type ${alias} = ${text};`);
        return alias;
    };
    const args = typeName(schema, 'args');
    const result = typeName(entry.output, 'result');
    return `${parts.length ? `namespace ${parts.join('.')} {\n` : ''}${types.length ? types.join('\n') + '\n\n' : ''}/**\n * @brief ${doc}\n * @returns Tool result\n */\nfunction ${name}(/** Tool arguments */ args: ${args}): Promise<${result}>;\n${parts.length ? '}' : ''}`;
}
