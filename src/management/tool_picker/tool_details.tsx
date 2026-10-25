import type { PhysicalTool } from '../../registry/registry.js';
import { useTranslation } from '../locale/locale.js';

/** @brief One documented schema field, including its complete nested path. */
interface SchemaField { name: string; type: string; description: string }

/** @brief Normalize a JSON schema node without interpreting metadata as HTML. */
function schemaRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** @brief Describe primitive, array, reference and composed schema types. */
function schemaType(value: unknown): string {
    if (typeof value === 'boolean') return value ? 'unknown' : 'never';
    const schema = schemaRecord(value);
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        const variants = schema[key];
        if (Array.isArray(variants)) return variants.map(schemaType).join(key === 'allOf' ? ' & ' : ' | ');
    }
    if (schema.items) return `(${schemaType(schema.items)})[]`;
    if (Array.isArray(schema.type)) return schema.type.join(' | ');
    if (typeof schema.type === 'string') return schema.type;
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

/** @brief Present tool metadata as HTML and parameter/return contracts as separate tables. */
export function ToolDetails({ tool, calls }: { tool: PhysicalTool; calls: number }) {
    const t = useTranslation();
    return <article className="ts-tool-details">
        <header className="ts-tool-detail-header">
            <div><span className="ts-tool-detail-label">{t('tool_name')}</span><h3><code>{tool.id}</code></h3></div>
            {tool.source && <span className="ts-tool-detail-source" aria-label={`${t('tool_source')}: ${tool.source}`}>{tool.source}</span>}
        </header>
        <section className="ts-tool-detail-overview"><h4>{t('tool_description')}</h4><p>{tool.description || t('tool_no_description')}</p></section>
        <SchemaTable label={t('tool_parameters')} schema={tool.parameters} />
        <SchemaTable label={t('tool_returns')} schema={tool.output} />
        <section className="ts-tool-statistics">
            <table>
                <caption>{t('tool_statistics')}</caption>
                <tbody><tr><th scope="row">{t('tool_total_calls')}</th><td>{calls}</td></tr></tbody>
            </table>
        </section>
    </article>;
}
