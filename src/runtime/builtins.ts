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
    overloads?: readonly string[];
    discardResult?: boolean;
    preload?: boolean;
}

/** @brief Own the shared plugin command table and its runtime and presentation projections. */
export class PluginCommands {
    /** @brief Profile commands available through ordinary guarded native dispatch. */
    readonly managementCommands: readonly BuiltinTool[] = [
        { tool: 'tools_profile_setdefault', path: 'tools.profile.setdefault', signature: '(name: string) => Promise<void>', discardResult: true, description: 'Set an existing catalog Profile as the global default for new conversations. Existing conversations keep their working configurations.', parameterDocs: { name: 'Existing catalog Profile to use by default for new conversations.' } },
        { tool: 'tools_profile_delete', path: 'tools.profile.delete', signature: '(name: string) => Promise<void>', discardResult: true, description: 'Delete a named catalog Profile. The current conversation Profile cannot be deleted.', parameterDocs: { name: 'Catalog Profile to delete.' } },
        { tool: 'tools_profile_switch', path: 'tools.profile.switch', signature: '(name: string) => Promise<void>', discardResult: true, description: 'Switch this conversation to a named catalog Profile.', parameterDocs: { name: 'Existing catalog Profile to select for this conversation.' } },
        { tool: 'tools_profile_load', path: 'tools.profile.load', signature: '(name?: string) => Promise<Profile>', description: 'Read a named catalog Profile as JSON data without changing the conversation, or return the current draft when name is omitted. Omitted permissions use ordinary node defaults: commentable/renamable/movable/removable/disableable true; acceptsChildren true for namespaces, false for commands; availableFixLevels [0,1] for namespaces, [0,1,2] for commands. Only nondefault permission fields are returned; fixedLevel defaults to 0 and disabled to false, both omitted at defaults.' },
        { tool: 'tools_profile_save', positional: [['profile'], ['name', 'profile']], overloads: ['(profile: Profile) => Promise<string | null>'], path: 'tools.profile.save', signature: '(name: string | undefined, profile: Profile) => Promise<string | null>', description: 'Replace the catalog Profile tree, recursively restoring missing protected builtin commands and namespaces while preserving supplied settings. The tools namespace is protected and defaults to disabled on save; explicitly set its disabled field to false to enable it. Omitted or undefined name uses the current conversation Profile name, ignoring profile.name. Call tools.profile.switch(name) to apply the saved Profile. When inspect is unavailable, including when tools is disabled, namespace members cannot be discovered; all other commands should be fixed at level 2 or disabled. This is advisory and does not block saving or change pin levels. Returns null on success without information, otherwise an informational string.', parameterDocs: { name: 'Target catalog name; defaults to the current conversation Profile name.', profile: 'Editable Profile tree; missing protected descendants are restored. The protected tools namespace defaults to disabled unless explicitly set to disabled: false; other supplied settings are preserved.' } },
    ];

    /** @brief Preloaded Profile values, with visibility preferences stored alongside builtin commands. */
    readonly profileValues: readonly BuiltinTool[] = [
        { tool: 'tools_profile_profiles', preload: true, path: 'tools.profile.profiles', signature: 'Profiles', description: 'Available Profile names and the currently selected conversation Profile. Updated after tool calls.' },
        { tool: 'tools_profile_annotation', preload: true, path: 'tools.profile.annotation', signature: 'string', description: 'English TypeScript declarations for the Profile data model.' },
        { tool: 'tools_profile_commands', preload: true, path: 'tools.profile.commands', signature: 'CommandBrief[]', description: 'All catalog commands excluding plugin builtins, with physical names, summaries, mount paths in this conversation Profile (including disabled paths; empty when unmounted), and total calls across all sessions. tools.inspect cannot retrieve information by physical command name; query an enabled mount path available in the current conversation instead.' },
    ];

    /** @brief Fixed discovery command available in both native and PTC modes. */
    readonly discoveryCommand: BuiltinTool = { tool: 'tools_inspect', path: 'tools.inspect', signature: '(queries: string[]) => Promise<string>', description: 'Query namespace members and complete TypeScript tool signatures.', parameterDocs: { queries: 'Array of namespace member paths or exact command paths. A trailing dot lists immediate members; an exact path returns the complete command contract. An optional global. prefix is ignored. Include an empty string ("") to query root namespace members: tools.inspect([""]).' } };

    /** @brief Optional-ranked command search, unpinned by default and independently disableable. */
    readonly searchCommand: BuiltinTool = {
        tool: 'tools_search', path: 'tools.search',
        signature: "(keywords: string[], method?: string, max_results?: number, target?: 'name' | 'description' | 'parameters' | 'all', namespace_path?: string) => Promise<string[]>",
        description: 'Search command names, descriptions, or parameters within a namespace subtree; defaults to the configured method, 10 results, all fields and the entire tree. Use tools.inspect for complete command details.',
    };

    /** @brief Derive the positional search signature from the installed physical contract. */
    searchContract(methods?: readonly string[]): BuiltinTool {
        return methods === undefined ? this.searchCommand : methods.length > 1 ? { ...this.searchCommand, signature: this.searchCommand.signature.replace('method?: string', `method?: ${methods.map(method => JSON.stringify(method)).join(' | ')}`) } : { ...this.searchCommand, signature: this.searchCommand.signature.replace("method?: string, ", '') };
    }

    /** @brief Pin only the discovery command by default. */
    readonly defaultBuiltinVisible: CommandVisibility = { [this.discoveryCommand.path]: 2 };

    /** @brief Builtin contracts indexed by physical identity for all namespace projections. */
    readonly builtinTools: readonly BuiltinTool[] = [this.discoveryCommand, this.searchCommand, ...this.managementCommands, ...this.profileValues];

    /** @brief Resolve a builtin contract once for declarations, invocation and runtime filtering. */
    find(tool: string): BuiltinTool | undefined { return this.builtinTools.find(command => command.tool === tool); }
}

/** @brief Shared command contracts used by all plugin components. */
export const pluginCommands = new PluginCommands();
