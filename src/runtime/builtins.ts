/** @brief Fixed command metadata shared by runtime declarations, completion and the read-only UI. */
export interface BuiltinCommand { path: string; signature: string; description: string }

/** @brief VM lifecycle commands; intermediate output is provided by the native console. */
export const vmCommands: readonly BuiltinCommand[] = [
    { path: 'vm.restart', signature: '(preserve?: readonly string[]) => never', description: 'Reset the Context, preserving named cloneable bindings and tool configuration.' },
];

/** @brief Native Node Console methods with their public signatures and English documentation. */
export const consoleCommands: readonly BuiltinCommand[] = [
    ...['log', 'info', 'debug', 'warn', 'error', 'dirxml'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: 'Format and write values to the execution output.' })),
    { path: 'console.dir', signature: '(value: unknown, options?: { depth?: number | null; colors?: boolean; showHidden?: boolean }) => void', description: 'Inspect an object and write it to the execution output.' },
    ...['time', 'timeEnd', 'count', 'countReset'].map(name => ({ path: `console.${name}`, signature: '(label?: string) => void', description: 'Manage a labeled console timer or counter.' })),
    ...['timeLog', 'trace', 'group', 'groupCollapsed'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: 'Write a timer, trace or group to the execution output.' })),
    { path: 'console.assert', signature: '(condition?: unknown, ...data: unknown[]) => void', description: 'Write an assertion failure when the condition is falsy.' },
    { path: 'console.table', signature: '(data: unknown, properties?: readonly string[]) => void', description: 'Display tabular data in the execution output.' },
    ...['clear', 'groupEnd'].map(name => ({ path: `console.${name}`, signature: '() => void', description: 'Clear the console or close the current console group.' })),
];

/** @brief Complete fixed callable surface for discovery without obsolete VM output callbacks. */
export const builtinCommands = [...vmCommands, ...consoleCommands];

/** @brief The VM lifecycle namespace is always present and cannot be reassigned or configured. */
export const vmDeclaration = `declare const vm: {
    /** @brief Reset the Context, preserving named cloneable bindings; functions cannot be transferred. */
    readonly restart: (preserve?: readonly string[]) => never;
};`;

/** @brief Declare only the native Console methods exposed by this runtime, independent of DOM types. */
export const consoleDeclaration = `declare const console: {\n${consoleCommands.map(command =>
    `    /** @brief ${command.description} */\n    readonly ${command.path.split('.').at(-1)}: ${command.signature};`).join('\n')}\n};`;
