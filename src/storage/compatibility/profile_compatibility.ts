/** @brief Convert persisted node formats and builtin removal names before constructing runtime nodes. */
export function upgradeProfileNodes(value: unknown, path = ''): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    if (node.type === 'command' && !Object.hasOwn(node, 'function')) {
        const { command, ...properties } = node;
        return upgradeProfileNodes({ ...properties, type: 'function', function: command }, path);
    }
    if (node.type === 'namespace' && node.children && typeof node.children === 'object' && !Array.isArray(node.children)) {
        const children = Object.fromEntries(Object.entries(node.children).map(([name, child]) =>
            [name, upgradeProfileNodes(child, path ? `${path}.${name}` : name)]));
        if (path === 'tools.profile' && Object.hasOwn(children, 'delete')) {
            if (!Object.hasOwn(children, 'remove')) children.remove = children.delete;
            delete children.delete;
        }
        return { ...node, children };
    }
    if (['tools.profile.delete', 'tools.profile.remove'].includes(path) && node.type === 'function') {
        const command = node.function as Record<string, unknown> | undefined;
        if (command?.tool === 'tools_profile_delete') return { ...node, function: { ...command, tool: 'tools_profile_remove' } };
    }
    return value;
}
