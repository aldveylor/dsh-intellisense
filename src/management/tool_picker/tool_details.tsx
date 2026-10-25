import { stringify } from 'yaml';
import type { PhysicalTool } from '../../registry/registry.js';
import { useTranslation } from '../locale/locale.js';

/** @brief Extract nested field descriptions while retaining undocumented schema types. */
function schemaDescription(value: unknown, empty: string): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
    const schema = value as Record<string, unknown>;
    const fields = schema.properties;
    const description = typeof schema.description === 'string' ? schema.description : undefined;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const entries = Object.entries(fields).map(([name, field]) => [name, schemaDescription(field, empty)]);
        return description ? { description, properties: Object.fromEntries(entries) } : Object.fromEntries(entries);
    }
    if (description) return description;
    if (schema.items) return [schemaDescription(schema.items, empty)];
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(schema[key])) return schema[key].map(item => schemaDescription(item, empty));
    }
    return schema.type ?? schema.$ref ?? empty;
}

/** @brief Display original tool contracts and the global dispatch total as readable YAML. */
export function ToolDetails({ tool, calls }: { tool: PhysicalTool; calls: number }) {
    const t = useTranslation();
    const details = {
        [t('tool_name')]: tool.id,
        ...(tool.source ? { [t('tool_source')]: tool.source } : {}),
        [t('tool_description')]: tool.description || t('tool_no_description'),
        [t('tool_parameters')]: schemaDescription(tool.parameters, t('tool_no_description')),
        [t('tool_returns')]: schemaDescription(tool.output, t('tool_no_description')),
        [t('tool_total_calls')]: calls,
    };
    return <pre className="ts-tool-details">{stringify(details, { lineWidth: 0 })}</pre>;
}
