/** @brief Fixed command metadata shared by runtime declarations, completion and the read-only UI. */
export interface BuiltinCommand { path: string; signature: string; description: string }

/** @brief VM lifecycle commands; intermediate output is provided by the native console. */
export const vmCommands: readonly BuiltinCommand[] = [
    { path: 'vm.restart', signature: '() => Promise<never>', description: 'Restart the entire VM, terminating running work and clearing all global state.' },
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

/** @brief Fixed management commands are ordinary native tools under the tools namespace. */
export const managementCommands: readonly BuiltinCommand[] = [
    { path: 'tools.mount', signature: '(args: { source: string; node: string; name?: string }) => Promise<unknown>', description: 'Mount a tool in the current conversation Profile.' },
    { path: 'tools.unmount', signature: '(args: { target: string }) => Promise<unknown>', description: 'Remove a mounted tool path from the current Profile.' },
    { path: 'tools.comment', signature: '(args: { tool: string; comment: string }) => Promise<unknown>', description: 'Edit a tool comment in the current Profile.' },
    { path: 'tools.fix', signature: '(args: { tool: string; fixed?: boolean }) => Promise<unknown>', description: 'Change whether a tool appears in the model prompt.' },
    { path: 'tools.commit', signature: '(args: { profile: string }) => Promise<unknown>', description: 'Save the conversation draft to a named Profile.' },
    { path: 'tools.profiles', signature: '(args: {}) => Promise<unknown>', description: 'List available Profiles and the current selection.' },
    { path: 'tools.loadprofile', signature: '(args: { profile: string }) => Promise<unknown>', description: 'Load a named Profile into this conversation.' },
];

/** @brief Fixed discovery command available in both native and PTC modes. */
export const discoveryCommand: BuiltinCommand = { path: 'tools.intellisense', signature: '(...queries: string[]) => Promise<string>', description: 'Query namespace members and complete TypeScript tool signatures.' };

/** @brief Default discovery includes custom commands and excludes standard console methods. */
export const defaultBuiltinVisible = [...vmCommands.map(command => command.path), discoveryCommand.path];

/** @brief Callable runtime commands and permanently visible signature discovery. */
export const builtinCommands = [...vmCommands, ...consoleCommands, discoveryCommand];
