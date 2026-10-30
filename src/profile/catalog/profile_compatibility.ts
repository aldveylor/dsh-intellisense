/** @brief Convert legacy command nodes without changing names, permissions or tool contracts. */
export function upgradeProfileNodes(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    if (node.type === 'command' && !Object.hasOwn(node, 'function')) {
        const { command, ...properties } = node;
        return { ...properties, type: 'function', function: command };
    }
    if (node.type === 'namespace' && node.children && typeof node.children === 'object' && !Array.isArray(node.children)) {
        return { ...node, children: Object.fromEntries(Object.entries(node.children).map(([name, child]) => [name, upgradeProfileNodes(child)])) };
    }
    return value;
}
