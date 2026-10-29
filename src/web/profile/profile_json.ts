import { array, boolean, literal, record, strictObject, string, union, unknown } from 'zod';

/** @brief Shared JSON Profile configuration validation for uploads and management writes. */
const mapping = strictObject({ id: string().min(1), path: string().min(1), description: string().optional(), pinned: boolean(), disabled: boolean().optional(), alwaysVisible: union([literal(0), literal(1), literal(2)]).optional() });
const visibility = record(string(), union([literal(0), literal(1), literal(2)]));
export const profileConfiguration = {
    brief: string().optional(),
    mappings: array(mapping),
    namespaces: array(strictObject({ path: string(), description: string(), alwaysVisible: boolean(), disabled: boolean().optional() })),
    builtinDisabled: array(string()).optional(), order: array(string()), unmountedVisible: visibility, builtinVisible: visibility,
    namespaceVisible: record(string(), boolean()), toolComments: record(string(), string()),
};

/** @brief Validate a complete uploaded configuration before replacing editor state. */
export function parseProfileJson(text: string) {
    const { nodeSettings: _nodeSettings, providedRoot: _providedRoot, ...configuration } = strictObject({
        ...profileConfiguration, nodeSettings: unknown().optional(), providedRoot: unknown().optional(),
    }).parse(JSON.parse(text.replace(/^\uFEFF/, '')));
    return configuration;
}
