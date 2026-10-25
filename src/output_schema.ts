/** @brief Copy an output schema without descriptions, preserving property names and literal values. */
export function outputSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
    const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
    const nodes = new Set(['items', 'additionalItems', 'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']);
    const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
    return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'description').map(([key, value]) => {
        if (maps.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
            return [key, Object.fromEntries(Object.entries(value).map(([name, field]) => [name, outputSchema(field)]))];
        }
        if ((arrays.has(key) || key === 'items') && Array.isArray(value)) return [key, value.map(outputSchema)];
        return [key, nodes.has(key) ? outputSchema(value) : value];
    }));
}
