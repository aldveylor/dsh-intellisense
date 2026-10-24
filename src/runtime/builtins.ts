import { bilingualDescription } from './localization/descriptions.js';
import type { CommandVisibility } from '../registry/registry.js';

/** @brief Fixed command metadata shared by runtime declarations, completion and the read-only UI. */
export interface BuiltinCommand { path: string; signature: string; description: string }

/** @brief Native Node Console methods with their public signatures and English documentation. */
export const consoleCommands: readonly BuiltinCommand[] = [
    ...['log', 'info', 'debug', 'warn', 'error', 'dirxml'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: bilingualDescription('Format and write values to the execution output.') })),
    { path: 'console.dir', signature: '(value: unknown, options?: { depth?: number | null; colors?: boolean; showHidden?: boolean }) => void', description: bilingualDescription('Inspect an object and write it to the execution output.') },
    ...['time', 'timeEnd', 'count', 'countReset'].map(name => ({ path: `console.${name}`, signature: '(label?: string) => void', description: bilingualDescription('Manage a labeled console timer or counter.') })),
    ...['timeLog', 'trace', 'group', 'groupCollapsed'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: bilingualDescription('Write a timer, trace or group to the execution output.') })),
    { path: 'console.assert', signature: '(condition?: unknown, ...data: unknown[]) => void', description: bilingualDescription('Write an assertion failure when the condition is falsy.') },
    { path: 'console.table', signature: '(data: unknown, properties?: readonly string[]) => void', description: bilingualDescription('Display tabular data in the execution output.') },
    ...['clear', 'groupEnd'].map(name => ({ path: `console.${name}`, signature: '() => void', description: bilingualDescription('Clear the console or close the current console group.') })),
];

/** @brief Profile commands available through ordinary guarded native dispatch. */
export const managementCommands: readonly BuiltinCommand[] = [
    { path: 'tools.profile.load', signature: '(name?: string) => Promise<Profile>', description: bilingualDescription('Load a named Profile, or return the current conversation Profile when name is omitted.') },
    { path: 'tools.profile.save', signature: '(name: string | undefined, profile: Profile) => Promise<void>', description: bilingualDescription('Save a Profile tree under name, defaulting to the current Profile name. Also accepts save(profile).') },
];

/** @brief Preloaded Profile values, with visibility preferences stored alongside builtin commands. */
export const profileValues: readonly BuiltinCommand[] = [
    { path: 'tools.profile.annotation', signature: 'string', description: bilingualDescription('English TypeScript declarations for the Profile data model.') },
    { path: 'tools.profile.commands', signature: 'CommandBrief[]', description: bilingualDescription('Show all commands, including commands absent from the current context, with their original physical names and summaries.') },
];

/** @brief Fixed discovery command available in both native and PTC modes. */
export const discoveryCommand: BuiltinCommand = { path: 'tools.intellisense', signature: '(args: string[]) => Promise<string>', description: bilingualDescription('Query namespace members and complete TypeScript tool signatures.') };

/** @brief Default discovery includes custom commands and excludes standard console methods. */
export const defaultBuiltinVisible: CommandVisibility = { [discoveryCommand.path]: 2 };

/** @brief Callable runtime commands and permanently visible signature discovery. */
export const builtinCommands = [...consoleCommands, discoveryCommand, ...managementCommands];
