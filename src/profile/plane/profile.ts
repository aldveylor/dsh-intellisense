import type { NamespaceTreeNode } from '../catalog/profile_node.js';
import type { ProfileNodeSettings } from '../node_settings.js';
import { storageVersion } from '../../storage/version.js';
import type { Saveable } from '../../storage/saveable.js';

/** @brief Command prompt exposure: hidden, brief, or fully documented. */
export type PinLevel = 0 | 1 | 2;

/** @brief Profile pin levels indexed by physical tool ID or builtin path. */
export type CommandVisibility = Record<string, PinLevel>;

/** @brief Semantic naming, exposure and stable path configuration. */
export interface Mapping {
    id: string;
    path: string;
    description?: string;
    pinned: boolean;
    alwaysVisible?: PinLevel;
    disabled?: boolean;
}

/** @brief Persisted namespace documentation and unconditional prompt visibility. */
export interface Namespace { disabled?: boolean; path: string; alwaysVisible: boolean; description: string }

/** @brief Versioned complete registry state, committed atomically. */
export interface PlaneProfileStateData { version: number; revision: number; brief?: string; providedRoot?: NamespaceTreeNode; nodeSettings?: ProfileNodeSettings; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; unmountedVisible?: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string>; profile?: string; profiles?: string[]; inactiveProfiles?: Record<string, PlaneProfileData> }
/** @brief A named configuration contains only tool tree settings. */
export interface PlaneProfileData { brief?: string; providedRoot?: NamespaceTreeNode; nodeSettings?: ProfileNodeSettings; mappings: Mapping[]; namespaces: Namespace[]; order: string[]; unmountedVisible: CommandVisibility; builtinDisabled?: string[]; builtinVisible?: CommandVisibility; namespaceVisible?: Record<string, boolean>; toolComments?: Record<string, string> }

/** @brief Owned Profile settings with detached serialization and constructor-based restoration. */
export class PlaneProfile implements Saveable<PlaneProfileData> {
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

    constructor(data?: Partial<PlaneProfileData>) {
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

    save(): PlaneProfileData {
        return structuredClone({ ...(this.brief === undefined ? {} : { brief: this.brief }), ...(this.providedRoot === undefined ? {} : { providedRoot: this.providedRoot }), nodeSettings: this.nodeSettings, mappings: this.mappings, namespaces: this.namespaces, order: this.order,
            unmountedVisible: this.unmountedVisible, builtinDisabled: this.builtinDisabled,
            builtinVisible: this.builtinVisible, namespaceVisible: this.namespaceVisible, toolComments: this.toolComments });
    }
}

/** @brief Versioned registry or session snapshot owning its active and archived configurations. */
export class PlaneProfileState extends PlaneProfile implements Saveable<PlaneProfileStateData> {
    version: number;
    revision: number;
    profile: string;
    declare profiles?: string[];
    declare inactiveProfiles?: Record<string, PlaneProfile>;

    constructor(data?: Partial<PlaneProfileStateData>) {
        super(data);
        this.version = data?.version ?? storageVersion;
        this.revision = data?.revision ?? 0;
        this.profile = data?.profile ?? 'Default';
        if (data?.profiles !== undefined) this.profiles = [...data.profiles];
        if (data?.inactiveProfiles !== undefined) this.inactiveProfiles = Object.fromEntries(
            Object.entries(data.inactiveProfiles).map(([name, configuration]) => [name, new PlaneProfile(configuration)]));
    }

    save(): PlaneProfileStateData & PlaneProfileData {
        return { ...super.save(), version: this.version, revision: this.revision, profile: this.profile,
            ...(this.profiles === undefined ? {} : { profiles: [...this.profiles] }),
            ...(this.inactiveProfiles === undefined ? {} : { inactiveProfiles: Object.fromEntries(
                Object.entries(this.inactiveProfiles).map(([name, configuration]) => [name, configuration.save()])) }) };
    }
}
