/** @brief Fixed global VM callbacks shared by runtime declarations, completion and the read-only UI. */
export const vmCommands = [
    { path: 'vm.print', signature: '(...values: unknown[]) => void', description: '将值输出给 agent，用于继续分析和执行；不直接回复用户。' },
    { path: 'vm.restart', signature: '(preserve?: readonly string[]) => never', description: '重置 VM，可按名称保留指定变量的可复制值；其余变量清除，工具配置保留。' },
] as const;

/** @brief The VM namespace is always present and cannot be reassigned or configured. */
export const vmDeclaration = `declare const vm: {
    /** Print values to the agent, then continue in a new generation with the same VM bindings. */
    readonly print: (...values: unknown[]) => void;
    /** Reset the Context, preserving named cloneable bindings; functions cannot be transferred. */
    readonly restart: (preserve?: readonly string[]) => never;
};`;
