/** @brief Fixed global VM callbacks shared by runtime declarations, completion and the read-only UI. */
export const vmCommands = [
    { path: 'vm.print', signature: '(...values: unknown[]) => void', description: 'Print values to the agent for further analysis; do not send them directly to the user.' },
    { path: 'vm.restart', signature: '(preserve?: readonly string[]) => never', description: 'Reset the Context, preserving named cloneable bindings and tool configuration.' },
] as const;

/** @brief The VM namespace is always present and cannot be reassigned or configured. */
export const vmDeclaration = `declare const vm: {
    /** Print values to the agent, then continue in a new generation with the same VM bindings. */
    readonly print: (...values: unknown[]) => void;
    /** Reset the Context, preserving named cloneable bindings; functions cannot be transferred. */
    readonly restart: (preserve?: readonly string[]) => never;
};`;
