import type { NamespaceTreeNode } from './profile_node.js';
import type { ProfileNodeSettings } from './profile/node_settings.js';
import { storageVersion } from '../storage/version.js';
import type { Saveable } from '../storage/saveable.js';
import type { Mapping, Namespace, CommandVisibility } from './registry.js';

/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryStateData { version: number; revision: number; brief?: string; providedRoot?: NamespaceTreeNode; nodeSettings?: ProfileNodeSettings; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; unmountedVisible?: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string>; profile?: string; profiles?: string[]; inactiveProfiles?: Record<string, RegistryConfigurationData> }
/** @brief A named configuration contains only tool tree settings. */
export interface RegistryConfigurationData { brief?: string; providedRoot?: NamespaceTreeNode; nodeSettings?: ProfileNodeSettings; mappings: Mapping[]; namespaces: Namespace[]; order: string[]; unmountedVisible: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string> }

/** @brief Owned Profile settings with detached serialization and constructor-based restoration. */
export class RegistryConfiguration implements Saveable<RegistryConfigurationData> {
    brief?: string;
    providedRoot?: NamespaceTreeNode;
    nodeSettings: ProfileNodeSettings;
    mappings: Mapping[];
    namespaces: Namespace[];
    order: string[];
    unmountedVisible: CommandVisibility;
    builtinDisabled: string[];
    builtinVisible: CommandVisibility;
    namespaceVisible: Record<string, boolean>;
    toolComments: Record<string, string>;

    constructor(data?: Partial<RegistryConfigurationData>) {
        this.brief = data?.brief;
        this.providedRoot = structuredClone(data?.providedRoot);
        this.nodeSettings = structuredClone(data?.nodeSettings ?? {});
        this.mappings = structuredClone(data?.mappings ?? []);
        this.namespaces = structuredClone(data?.namespaces ?? []);
        this.order = structuredClone(data?.order ?? []);
        this.unmountedVisible = structuredClone(data?.unmountedVisible ?? {});
        this.builtinDisabled = structuredClone(data?.builtinDisabled ?? []);
        this.builtinVisible = structuredClone(data?.builtinVisible ?? {});
        this.namespaceVisible = structuredClone(data?.namespaceVisible ?? {});
        this.toolComments = structuredClone(data?.toolComments ?? {});
    }

    save(): RegistryConfigurationData {
        return structuredClone({ ...(this.brief === undefined ? {} : { brief: this.brief }), ...(this.providedRoot === undefined ? {} : { providedRoot: this.providedRoot }), nodeSettings: this.nodeSettings, mappings: this.mappings, namespaces: this.namespaces, order: this.order,
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
        this.version = data?.version ?? storageVersion;
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
