import type { CommandVisibility } from '../registry/registry.js';

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

/** @brief Profile commands available through ordinary guarded native dispatch. */
export const managementCommands: readonly BuiltinCommand[] = [
    { path: 'tools.profile.load', signature: '(name?: string) => Promise<Profile>', description: 'Load a named Profile, or return the current conversation Profile when name is omitted.' },
    { path: 'tools.profile.save', signature: '(name: string | undefined, profile: Profile) => Promise<void>', description: 'Save a Profile tree under name, defaulting to the current Profile name. Also accepts save(profile).' },
];

/** @brief Preloaded Profile values, with visibility preferences stored alongside builtin commands. */
export const profileValues: readonly BuiltinCommand[] = [
    { path: 'tools.profile.annotation', signature: 'string', description: 'English TypeScript declarations for the Profile data model.' },
    { path: 'tools.profile.commands', signature: 'CommandBrief[]', description: 'Show all commands, including commands absent from the current context, with their original physical names and summaries.' },
];

/** @brief Fixed discovery command available in both native and PTC modes. */
export const discoveryCommand: BuiltinCommand = { path: 'tools.intellisense', signature: '(args: string[]) => Promise<string>', description: 'Query namespace members and complete TypeScript tool signatures.' };

/** @brief Default discovery includes custom commands and excludes standard console methods. */
export const defaultBuiltinVisible: CommandVisibility = Object.fromEntries([...vmCommands.map(command => command.path), discoveryCommand.path].map(path => [path, path === discoveryCommand.path ? 2 : 1]));

/** @brief Callable runtime commands and permanently visible signature discovery. */
export const builtinCommands = [...vmCommands, ...consoleCommands, discoveryCommand, ...managementCommands];
