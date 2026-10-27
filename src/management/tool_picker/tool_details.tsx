import { outputSchema } from '../../output_schema.js';
import { TooltipProvider, useTooltip } from '../tooltip/tooltip.js';
import { TypeScriptBlock } from '../code_block/code_block.js';
import type { PhysicalTool } from '../../registry/registry.js';
import { useTranslation } from '../locale/locale.js';

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
        if (!fields.length && schema.additionalProperties !== false) return 'Record<string, unknown>';
        if (schema.additionalProperties !== false) fields.push(`${indent}  [key: string]: unknown;`);
        return fields.length ? `{\n${fields.join('\n')}\n${indent}}` : 'Record<string, never>';
    }
    if (schema.type === 'array') return 'unknown[]';
    if (Array.isArray(schema.type)) return schema.type.map(type => type === 'integer' ? 'number' : type).join(' | ');
    if (typeof schema.type === 'string') return schema.type === 'integer' ? 'number' : schema.type;
    if (typeof schema.$ref === 'string') return schema.$ref;
    return schema.properties ? 'object' : 'unknown';
}

/** @brief Keep parameter types compact and reveal their full declaration in a nested tooltip. */
function ParameterType({ schema }: { schema: unknown }) {
    const tooltip = useTooltip();
    const details = <div className="ts-parameter-type-code"><TypeScriptBlock code={schemaType(schema, true)} /></div>;
    return <code className="ts-parameter-type" tabIndex={0} aria-describedby={tooltip.id}
        onPointerEnter={event => { event.stopPropagation(); tooltip.show(details, event.clientX, event.clientY); }}
        onPointerMove={event => { event.stopPropagation(); tooltip.move(event.clientX, event.clientY, event.ctrlKey); }}
        onPointerLeave={tooltip.leave} onFocus={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(details, rect.left, rect.bottom);
        }} onBlur={tooltip.leave}>{schemaType(schema)}</code>;
}

/** @brief Render a schema as a semantic table of field names, types and descriptions. */
function SchemaTable({ label, schema }: { label: string; schema: unknown }) {
    const t = useTranslation();
    const definition = schemaRecord(schema);
    const properties = Object.entries(schemaRecord(definition.properties));
    const rows = properties.length ? properties.map(([name, field]) => ({ name, schema: field }))
        : definition.type === 'object' && !definition.additionalProperties ? [] : [{ name: label, schema }];

    return <section className="ts-tool-schema">
        <h4>{label}</h4>
        {(properties.length > 0 || !rows.length) && typeof definition.description === 'string' && <p>{definition.description}</p>}
        <table aria-label={label}>
            <thead><tr><th scope="col">{t('tool_field_name')}</th><th scope="col">{t('tool_field_type')}</th><th scope="col">{t('tool_field_description')}</th></tr></thead>
            <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>
                <th scope="row"><code>{row.name}</code></th><td><ParameterType schema={row.schema} /></td><td>{String(schemaRecord(row.schema).description || t('tool_no_description'))}</td>
            </tr>) : <tr><td colSpan={3}>{t('tool_no_fields')}</td></tr>}</tbody>
        </table>
    </section>;
}

/** @brief Present tool metadata, parameter fields and a TypeScript return declaration. */
export function ToolDetails({ tool, calls, queries = 0 }: { tool: PhysicalTool; calls: number; queries?: number }) {
    const t = useTranslation();
    const output = outputSchema(tool.output);
    return <article className="ts-tool-details">
        <header className="ts-tool-detail-header">
            <div><h3><code>{tool.id}</code></h3><p>{tool.description || t('tool_no_description')}</p></div>
            {tool.source && <span className="ts-tool-detail-source" aria-label={t('tool_source_detail', { source: tool.source })}>{tool.source}</span>}
        </header>
        <TooltipProvider><SchemaTable label={t('tool_parameters')} schema={tool.parameters} /></TooltipProvider>
        <section className="ts-tool-return">
            <h4>{t('tool_returns')}</h4>
            <TypeScriptBlock code={tool.outputDeclaration ?? schemaType(output, true)} />
        </section>
        <ToolStatistics calls={calls} queries={queries} />
    </article>;
}

/** @brief Share global call and Inspect query totals between tool and namespace details. */
export function ToolStatistics({ calls, queries = 0 }: { calls?: number; queries?: number }) {
    const t = useTranslation();
    return <section className="ts-tool-statistics">
        <h4>{t('tool_statistics')}</h4>
        <table aria-label={t('tool_statistics')}>
            <tbody>
                {calls !== undefined && <tr><th scope="row">{t('tool_total_calls')}</th><td>{calls}</td></tr>}
                <tr><th scope="row">{t('tool_total_queries')}</th><td>{queries}</td></tr>
            </tbody>
        </table>
    </section>;
}
