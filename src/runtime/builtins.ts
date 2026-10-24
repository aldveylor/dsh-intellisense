import type { CommandVisibility } from '../registry/registry.js';

/** @brief Plugin-owned execution entry, separate from the globally reserved run_code transport. */
export const ptcToolName = 'tools_run_code';

/** @brief Fixed command metadata shared by runtime declarations, completion and the read-only UI. */
export interface BuiltinCommand { path: string; signature: string; description: string }

/** @brief Shared native identities, positional layouts and data-only runtime bindings. */
export interface BuiltinTool extends BuiltinCommand {
    tool: string;
    positional?: readonly (readonly string[])[];
    rest?: string;
    overloads?: readonly string[];
    discardResult?: boolean;
    preload?: boolean;
}

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
export const managementCommands: readonly BuiltinTool[] = [
    { tool: 'tools_profile_load', path: 'tools.profile.load', signature: '(name?: string) => Promise<Profile>', description: 'Load a named Profile, or return the current conversation Profile when name is omitted.' },
    { tool: 'tools_profile_save', positional: [['profile'], ['name', 'profile']], overloads: ['(profile: Profile) => Promise<void>'], discardResult: true, path: 'tools.profile.save', signature: '(name: string | undefined, profile: Profile) => Promise<void>', description: 'Save a Profile tree under name, defaulting to the current Profile name. Also accepts save(profile).' },
];

/** @brief Preloaded Profile values, with visibility preferences stored alongside builtin commands. */
export const profileValues: readonly BuiltinTool[] = [
    { tool: 'tools_profile_annotation', preload: true, path: 'tools.profile.annotation', signature: 'string', description: 'English TypeScript declarations for the Profile data model.' },
    { tool: 'tools_profile_commands', preload: true, path: 'tools.profile.commands', signature: 'CommandBrief[]', description: 'Show all commands, including commands absent from the current context, with their original physical names and summaries.' },
];

/** @brief Fixed discovery command available in both native and PTC modes. */
export const discoveryCommand: BuiltinTool = { tool: 'tools_intellisense', rest: 'queries', path: 'tools.intellisense', signature: '(...args: string[]) => Promise<string>', description: 'Query namespace members and complete TypeScript tool signatures. Pass an empty string ("") to query root namespace members.' };

/** @brief Default discovery includes custom commands and excludes standard console methods. */
export const defaultBuiltinVisible: CommandVisibility = { [discoveryCommand.path]: 2 };

/** @brief Callable runtime commands and permanently visible signature discovery. */
export const builtinCommands = [...consoleCommands, discoveryCommand, ...managementCommands];

/** @brief Builtin contracts indexed by physical identity for all namespace projections. */
export const builtinTools: readonly BuiltinTool[] = [discoveryCommand, ...managementCommands, ...profileValues];

/** @brief Resolve a builtin contract once for declarations, invocation and runtime filtering. */
export function builtinTool(tool: string): BuiltinTool | undefined { return builtinTools.find(command => command.tool === tool); }
