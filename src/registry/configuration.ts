import type { Saveable } from '../storage/saveable.js';
import type { Mapping, Namespace, CommandVisibility } from './registry.js';
import { pluginCommands } from '../runtime/builtins.js';

/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryStateData { version: number; revision: number; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; unmountedVisible?: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string>; profile?: string; profiles?: string[]; inactiveProfiles?: Record<string, RegistryConfigurationData> }
/** @brief A named configuration contains only tool tree settings. */
export interface RegistryConfigurationData { mappings: Mapping[]; namespaces: Namespace[]; order: string[]; unmountedVisible: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string> }

/** @brief Owned Profile settings with detached serialization and constructor-based restoration. */
export class RegistryConfiguration implements Saveable<RegistryConfigurationData> {
    mappings: Mapping[];
    namespaces: Namespace[];
    order: string[];
    unmountedVisible: CommandVisibility;
    builtinDisabled: string[];
    builtinVisible: CommandVisibility;
    namespaceVisible: Record<string, boolean>;
    toolComments: Record<string, string>;

    constructor(data?: Partial<RegistryConfigurationData>) {
        this.mappings = structuredClone(data?.mappings ?? []);
        this.namespaces = structuredClone(data?.namespaces ?? []);
        this.order = structuredClone(data?.order ?? []);
        this.unmountedVisible = structuredClone(data?.unmountedVisible ?? {});
        this.builtinDisabled = structuredClone(data?.builtinDisabled ?? []);
        this.builtinVisible = structuredClone(data?.builtinVisible ?? pluginCommands.defaultBuiltinVisible);
        this.namespaceVisible = structuredClone(data?.namespaceVisible ?? {});
        this.toolComments = structuredClone(data?.toolComments ?? {});
    }

    save(): RegistryConfigurationData {
        return structuredClone({ mappings: this.mappings, namespaces: this.namespaces, order: this.order,
            unmountedVisible: this.unmountedVisible, builtinDisabled: this.builtinDisabled,
            builtinVisible: this.builtinVisible, namespaceVisible: this.namespaceVisible, toolComments: this.toolComments });
    }
}

/** @brief Versioned registry or session snapshot owning its active and archived configurations. */
export class RegistryState extends RegistryConfiguration implements Saveable<RegistryStateData> {
    version: number;
    revision: number;
    profile: string;
    declare profiles?: string[];
    declare inactiveProfiles?: Record<string, RegistryConfiguration>;

    constructor(data?: Partial<RegistryStateData>) {
        super(data);
        this.version = data?.version ?? 1;
        this.revision = data?.revision ?? 0;
        this.profile = data?.profile ?? 'Default';
        if (data?.profiles !== undefined) this.profiles = [...data.profiles];
        if (data?.inactiveProfiles !== undefined) this.inactiveProfiles = Object.fromEntries(
            Object.entries(data.inactiveProfiles).map(([name, configuration]) => [name, new RegistryConfiguration(configuration)]));
    }

    save(): RegistryStateData & RegistryConfigurationData {
        return { ...super.save(), version: this.version, revision: this.revision, profile: this.profile,
            ...(this.profiles === undefined ? {} : { profiles: [...this.profiles] }),
            ...(this.inactiveProfiles === undefined ? {} : { inactiveProfiles: Object.fromEntries(
                Object.entries(this.inactiveProfiles).map(([name, configuration]) => [name, configuration.save()])) }) };
    }
}
