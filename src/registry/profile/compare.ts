/** @brief Compare object trees into recursive patches; omitted keys become explicit deletions. */
export function compareProfile(before: unknown, after: unknown): Record<string, unknown> {
    const source = before && typeof before === 'object' ? before as Record<string, unknown> : {};
    const target = after && typeof after === 'object' ? after as Record<string, unknown> : {};
    const patch: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(source), ...Object.keys(target)])) {
        if (!Object.hasOwn(target, key)) patch[key] = null;
        else if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) {
            const value = target[key];
            const previous = source[key] as Record<string, unknown> | undefined;
            const changedKind = value && typeof value === 'object' && previous && typeof previous === 'object'
                && (value as Record<string, unknown>).type !== previous.type;
            patch[key] = value && typeof value === 'object' && !Array.isArray(value) && !changedKind
                ? compareProfile(source[key], value) : value;
        }
    }
    return patch;
}
