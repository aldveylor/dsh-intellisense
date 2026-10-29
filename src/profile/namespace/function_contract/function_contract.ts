import { decodeHTML } from 'entities';
import { outputSchema } from '../../../output_schema.js';
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import { jsonSchemaToTs } from '@deepseek-ai/dsh-tool-executor-ptc';
import type { ManifestEntry } from '../namespace.js';

/** @brief One positional parameter projected from a native object contract. */
interface Parameter { name: string; schema: JsonSchemaNode; required: boolean }

/** @brief Expand named fields in stable required-first order; keep unconstrained objects as one argument. */
export function parameters(entry: ManifestEntry): Parameter[] | undefined {
    if (entry.schema.type !== 'object' || entry.schema.oneOf) return;
    const fields = Object.entries(entry.schema.properties as Record<string, JsonSchemaNode> ?? {});
    if (!fields.length && entry.schema.additionalProperties !== false) return;
    return fields.map(([name, schema]) => ({ name, schema, required: (entry.schema.required as string[] | undefined)?.includes(name) ?? false }))
        .sort((a, b) => Number(b.required) - Number(a.required));
}

/** @brief Validate named DSML arguments against the physical tool contract. */
export function nativeArgumentsFor(entry: ManifestEntry, input: unknown): unknown {
    const errors = validateJsonSchemaValue(entry.schema as JsonSchemaNode, input);
    if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
    return input;
}

/** @brief Select only unambiguous single-property object results for scalar projection. */
export function resultField(entry: ManifestEntry): [string, JsonSchemaNode] | undefined {
    const output = entry.output as JsonSchemaNode | undefined;
    if (!output || output.type !== 'object' || output.oneOf) return;
    const fields = Object.entries(output.properties ?? {});
    return fields.length === 1 ? fields[0] : undefined;
}

/** @brief Unwrap the native response using the same contract exposed by Inspect. */
export function resultFor(entry: ManifestEntry, value: unknown): unknown {
    const field = resultField(entry);
    return field && value && typeof value === 'object' ? Object.hasOwn(value, field[0]) ? (value as Record<string, unknown>)[field[0]] : undefined : value;
}

/** @brief Project one manifest contract into a leaf declaration for the shared namespace tree. */
export function functionDeclaration(entry: ManifestEntry): string {
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
    const result = typeName(outputSchema(field?.[1] ?? entry.output), 'result');
    const optionalResult = field && !(entry.output as JsonSchemaNode).required?.includes(field[0]) ? ' | undefined' : '';
    return `${types.length ? types.join('\n') + '\n\n' : ''}/**\n * @brief ${doc(entry.doc)}\n${parameterDocs ? parameterDocs + '\n' : ''} */\nfunction ${name}(${args}): Promise<${result}${optionalResult}>;\n`;
}
