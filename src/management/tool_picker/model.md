import { TypeScriptBlock } from '../code_block/code_block.js';
import type { PhysicalTool } from '../../registry/registry.js';
import { useTranslation } from '../locale/locale.js';

/** @brief One documented schema field, including its complete nested path. */
interface SchemaField { name: string; type: string; description: string }

/** @brief Normalize a JSON schema node without interpreting metadata as HTML. */
function schemaRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** @brief Describe primitive, array, reference and composed schema types. */
function schemaType(value: unknown, detailed = false, depth = 0): string {
    if (typeof value === 'boolean') return value ? 'unknown' : 'never';
    const schema = schemaRecord(value);
    if (detailed && Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const) ?? 'unknown';
    if (detailed && Array.isArray(schema.enum)) return schema.enum.map(item => JSON.stringify(item)).join(' | ') || 'never';
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        const variants = schema[key];
        if (Array.isArray(variants)) return variants.map(variant => schemaType(variant, detailed, depth)).join(key === 'allOf' ? ' & ' : ' | ');
    }
    if (schema.items) return `(${schemaType(schema.items, detailed, depth)})[]`;
    if (detailed && (schema.type === 'object' || schema.properties)) {
        const indent = '  '.repeat(depth);
        const required = Array.isArray(schema.required) ? schema.required : [];
        const fields = Object.entries(schemaRecord(schema.properties)).map(([key, field]) => {
            const definition = schemaRecord(field);
            const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
            const description = typeof definition.description === 'string' ? definition.description.trim() : '';
            const comment = description ? `${indent}  /** ${description.replace(/\s+/g, ' ').replaceAll('*/', '* /')} */\n` : '';
            const optional = required.includes(key) || definition.required === true ? '' : '?';
            return `${comment}${indent}  ${name}${optional}: ${schemaType(field, true, depth + 1)};`;
        });
        if (schema.additionalProperties !== false) fields.push(`${indent}  [key: string]: unknown;`);
        return fields.length ? `{\n${fields.join('\n')}\n${indent}}` : 'Record<string, never>';
    }
    if (Array.isArray(schema.type)) return schema.type.join(' | ');
    if (typeof schema.type === 'string') return schema.type === 'integer' ? 'number' : schema.type;
    if (typeof schema.$ref === 'string') return schema.$ref;
    return schema.properties ? 'object' : 'unknown';
}

/** @brief Flatten nested properties, array items and union variants into documented rows. */
function schemaFields(value: unknown, name: string): SchemaField[] {
    const schema = schemaRecord(value);
    const rows: SchemaField[] = [{ name, type: schemaType(value), description: typeof schema.description === 'string' ? schema.description : '' }];
    for (const [key, field] of Object.entries(schemaRecord(schema.properties))) {
        rows.push(...schemaFields(field, name ? `${name}.${key}` : key));
    }
    if (schema.items) rows.push(...schemaFields(schema.items, `${name}[]`));
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        const variants = schema[key];
        if (Array.isArray(variants)) variants.forEach((variant, index) => rows.push(...schemaFields(variant, `${name} (${index + 1})`)));
    }
    return rows;
}

/** @brief Render a schema as a semantic table of field names, types and descriptions. */
function SchemaTable({ label, schema }: { label: string; schema: unknown }) {
    const t = useTranslation();
    const definition = schemaRecord(schema);
    const properties = Object.entries(schemaRecord(definition.properties));
    const rows = properties.length ? properties.flatMap(([name, field]) => schemaFields(field, name))
        : definition.type === 'object' && !definition.additionalProperties ? [] : schemaFields(schema, label);

    return <section className="ts-tool-schema">
        {(properties.length > 0 || !rows.length) && typeof definition.description === 'string' && <p>{definition.description}</p>}
        <table>
            <caption>{label}</caption>
            <thead><tr><th scope="col">{t('tool_field_name')}</th><th scope="col">{t('tool_field_type')}</th><th scope="col">{t('tool_field_description')}</th></tr></thead>
            <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>
                <th scope="row"><code>{row.name}</code></th><td><code>{row.type}</code></td><td>{row.description || t('tool_no_description')}</td>
            </tr>) : <tr><td colSpan={3}>{t('tool_no_fields')}</td></tr>}</tbody>
        </table>
    </section>;
}

/** @brief Present tool metadata, parameter fields and a TypeScript return declaration. */
export function ToolDetails({ tool, calls }: { tool: PhysicalTool; calls: number }) {
    const t = useTranslation();
    const output = schemaRecord(tool.output);
    return <article className="ts-tool-details">
        <header className="ts-tool-detail-header">
            <div><span className="ts-tool-detail-label">{t('tool_name')}</span><h3><code>{tool.id}</code></h3></div>
            {tool.source && <span className="ts-tool-detail-source" aria-label={`${t('tool_source')}: ${tool.source}`}>{tool.source}</span>}
        </header>
        <section className="ts-tool-detail-overview"><h4>{t('tool_description')}</h4><p>{tool.description || t('tool_no_description')}</p></section>
        <SchemaTable label={t('tool_parameters')} schema={tool.parameters} />
        <section className="ts-tool-return">
            <h4>{t('tool_returns')}</h4>
            {typeof output.description === 'string' && output.description.trim() && <p>{output.description}</p>}
            <TypeScriptBlock code={tool.outputDeclaration ?? `type Result = ${schemaType(tool.output, true)};`} />
        </section>
        <section className="ts-tool-statistics">
            <table>
                <caption>{t('tool_statistics')}</caption>
                <tbody><tr><th scope="row">{t('tool_total_calls')}</th><td>{calls}</td></tr></tbody>
            </table>
        </section>
    </article>;
}

参数表类型列使用完整 schema 展开，避免把具有 properties 的对象及对象数组简化为 object；开放且无具名字段的对象显示 Record<string, unknown>。返回代码块隐藏宿主标题栏及外框，保留 TypeScript 高亮。
