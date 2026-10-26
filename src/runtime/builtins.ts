import type { CommandVisibility } from '../registry/registry.js';

/** @brief Plugin-owned execution entry, separate from the globally reserved run_code transport. */
export const ptcToolName = 'tools_run_code';

/** @brief Execution transports excluded from physical namespace mappings and tool pickers. */
export const reservedToolIds: readonly string[] = Object.freeze(['exec', 'run_code', ptcToolName]);

/** @brief Fixed command metadata shared by runtime declarations, completion and the read-only UI. */
export interface BuiltinCommand { path: string; signature: string; description: string; parameterDocs?: Readonly<Record<string, string>> }

/** @brief Shared native identities, positional layouts and data-only runtime bindings. */
export interface BuiltinTool extends BuiltinCommand {
    tool: string;
    positional?: readonly (readonly string[])[];
    rest?: string;
    overloads?: readonly string[];
    discardResult?: boolean;
    preload?: boolean;
}

/** @brief Own the shared plugin command table and its runtime and presentation projections. */
export class PluginCommands {
    /** @brief Native Node Console methods with their public signatures and English documentation. */
    readonly consoleCommands: readonly BuiltinCommand[] = [
        ...['log', 'info', 'debug', 'warn', 'error', 'dirxml'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: 'Format and write values to the execution output.' })),
        { path: 'console.dir', signature: '(value: unknown, options?: { depth?: number | null; colors?: boolean; showHidden?: boolean }) => void', description: 'Inspect an object and write it to the execution output.' },
        ...['time', 'timeEnd', 'count', 'countReset'].map(name => ({ path: `console.${name}`, signature: '(label?: string) => void', description: 'Manage a labeled console timer or counter.' })),
        ...['timeLog', 'trace', 'group', 'groupCollapsed'].map(name => ({ path: `console.${name}`, signature: '(...data: unknown[]) => void', description: 'Write a timer, trace or group to the execution output.' })),
        { path: 'console.assert', signature: '(condition?: unknown, ...data: unknown[]) => void', description: 'Write an assertion failure when the condition is falsy.' },
        { path: 'console.table', signature: '(data: unknown, properties?: readonly string[]) => void', description: 'Display tabular data in the execution output.' },
        ...['clear', 'groupEnd'].map(name => ({ path: `console.${name}`, signature: '() => void', description: 'Clear the console or close the current console group.' })),
    ];

    /** @brief Profile commands available through ordinary guarded native dispatch. */
    readonly managementCommands: readonly BuiltinTool[] = [
        { tool: 'tools_profile_delete', path: 'tools.profile.delete', signature: '(name: string) => Promise<void>', discardResult: true, description: 'Delete a named catalog Profile. The current conversation Profile cannot be deleted.', parameterDocs: { name: 'Catalog Profile to delete.' } },
        { tool: 'tools_profile_switch', path: 'tools.profile.switch', signature: '(name: string) => Promise<void>', discardResult: true, description: 'Switch this conversation to a named catalog Profile.', parameterDocs: { name: 'Existing catalog Profile to select for this conversation.' } },
        { tool: 'tools_profile_load', path: 'tools.profile.load', signature: '(name?: string) => Promise<Profile>', description: 'Read a named catalog Profile as JSON data without changing the conversation, or return the current draft when name is omitted.' },
        { tool: 'tools_profile_save', positional: [['profile'], ['name', 'profile']], overloads: ['(profile: Profile) => Promise<void>'], discardResult: true, path: 'tools.profile.save', signature: '(name: string | undefined, profile: Profile) => Promise<void>', description: 'Save a Profile tree to the catalog. Omitted or undefined name uses the current conversation Profile name, ignoring profile.name. Call tools.profile.switch(name) to apply the saved Profile.', parameterDocs: { name: 'Target catalog name; defaults to the current conversation Profile name.', profile: 'Editable Profile tree; missing protected descendants are restored without overwriting supplied settings.' } },
    ];

    /** @brief Preloaded Profile values, with visibility preferences stored alongside builtin commands. */
    readonly profileValues: readonly BuiltinTool[] = [
        { tool: 'tools_profile_profiles', preload: true, path: 'tools.profile.profiles', signature: 'Profiles', description: 'Available Profile names and the currently selected conversation Profile. Updated after tool calls.' },
        { tool: 'tools_profile_annotation', preload: true, path: 'tools.profile.annotation', signature: 'string', description: 'English TypeScript declarations for the Profile data model.' },
        { tool: 'tools_profile_commands', preload: true, path: 'tools.profile.commands', signature: 'CommandBrief[]', description: 'All catalog commands with original physical names, summaries and total calls across all sessions.' },
    ];

    /** @brief Fixed discovery command available in both native and PTC modes. */
    readonly discoveryCommand: BuiltinTool = { tool: 'tools_intellisense', rest: 'queries', path: 'tools.intellisense', signature: '(...args: string[]) => Promise<string>', description: 'Query namespace members and complete TypeScript tool signatures. Pass an empty string ("") to query root namespace members.' };

    /** @brief Optional-ranked command search, unpinned by default and independently disableable. */
    readonly searchCommand: BuiltinTool = {
        tool: 'tools_search', path: 'tools.search',
        signature: "(keywords: string[], method?: string, max_results?: number, target?: 'name' | 'description' | 'parameters' | 'all', namespace_path?: string) => Promise<string[]>",
        description: 'Search command names, descriptions, or parameters within a namespace subtree; defaults to the configured method, 10 results, all fields and the entire tree. Use tools.intellisense for complete command details.',
    };

    /** @brief Derive the positional search signature from the installed physical contract. */
    searchContract(methods?: readonly string[]): BuiltinTool {
        return methods === undefined ? this.searchCommand : methods.length > 1 ? { ...this.searchCommand, signature: this.searchCommand.signature.replace('method?: string', `method?: ${methods.map(method => JSON.stringify(method)).join(' | ')}`) } : { ...this.searchCommand, signature: this.searchCommand.signature.replace("method?: string, ", '') };
    }

    /** @brief Default discovery includes custom commands and excludes standard console methods. */
    readonly defaultBuiltinVisible: CommandVisibility = { [this.discoveryCommand.path]: 2 };

    /** @brief Callable runtime commands and permanently visible signature discovery. */
    readonly builtinCommands = [...this.consoleCommands, this.discoveryCommand, this.searchCommand, ...this.managementCommands];

    /** @brief Builtin contracts indexed by physical identity for all namespace projections. */
    readonly builtinTools: readonly BuiltinTool[] = [this.discoveryCommand, this.searchCommand, ...this.managementCommands, ...this.profileValues];

    /** @brief Resolve a builtin contract once for declarations, invocation and runtime filtering. */
    find(tool: string): BuiltinTool | undefined { return this.builtinTools.find(command => command.tool === tool); }
}

/** @brief Shared command contracts used by all plugin components. */
export const pluginCommands = new PluginCommands();
