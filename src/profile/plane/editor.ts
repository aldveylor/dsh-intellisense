import type { ProfileSnapshot } from '../profile.js';
import type { PhysicalTool, SemanticRegistry } from '../catalog/registry.js';
import type { PlaneProfileData, PlaneProfileStateData, Mapping } from './profile.js';

/** @brief One revision-checked flat editor write, with catalog selection kept separate from tree data. */
export interface PlaneProfileEdit extends PlaneProfileData {
    revision: number;
    profile?: string;
    editingProfile?: string;
    activate?: boolean;
}

/** @brief Flat Profile management exposed through toolsNamespace independently of the physical tool service. */
export interface PlaneProfileEditor {
    /** @brief Read detached editor state and catalog configuration. */
    snapshot(): Promise<PlaneProfileStateData & PlaneProfileData>;
    /** @brief Read one named flat configuration. */
    configuration(name: string): Promise<PlaneProfileData>;
    /** @brief Read nonempty descriptions by catalog name. */
    briefs(): Promise<Record<string, string>>;
    /** @brief Read the provider-owned namespace snapshot used by the management tree. */
    provided(name: string): Promise<ProfileSnapshot>;
    /** @brief Manage catalog names and defaults under a checked revision. */
    manageProfile(action: 'create' | 'select' | 'rename' | 'delete', name: string, revision: number, newName?: string, activate?: boolean): Promise<void>;
    /** @brief Validate and publish a flat editor target using currently available physical metadata. */
    configure(value: PlaneProfileEdit, tools: PhysicalTool[]): Promise<void>;
    /** @brief Project active mounts for the editor without owning the physical catalog. */
    effective(tools: PhysicalTool[]): Promise<Array<Mapping & { tool: PhysicalTool }>>;
}

/** @brief Adapt the internal registry to the portable flat Profile editor contract. */
export class RegistryPlaneEditor implements PlaneProfileEditor {
    constructor(private readonly registry: SemanticRegistry, private readonly initialize: () => Promise<void>) {}

    async snapshot(): Promise<PlaneProfileStateData & PlaneProfileData> { await this.initialize(); return this.registry.snapshot().save(); }
    async configuration(name: string): Promise<PlaneProfileData> { await this.initialize(); return this.registry.configuration(name).save(); }
    async briefs(): Promise<Record<string, string>> { await this.initialize(); return this.registry.profileBriefs(); }

    async provided(name: string): Promise<ProfileSnapshot> {
        await this.initialize();
        return this.registry.definitions.profile({ root: this.registry.configuration(name).providedRoot ?? this.registry.definitions.tree(name) });
    }

    async manageProfile(action: 'create' | 'select' | 'rename' | 'delete', name: string, revision: number, newName?: string, activate = true): Promise<void> {
        await this.initialize();
        await this.registry.profileTransaction(() => this.registry.manageProfile(action, name, revision, newName, activate));
    }

    async configure(value: PlaneProfileEdit, tools: PhysicalTool[]): Promise<void> {
        await this.initialize();
        await this.registry.profileTransaction(async () => {
            this.registry.refresh(tools);
            await this.registry.configure(value.mappings, value.revision, value.namespaces, value.order, value.unmountedVisible, value.profile, value.toolComments,
                value.builtinVisible, value.namespaceVisible, value.editingProfile, value.activate, value.builtinDisabled, value.brief);
        });
    }

    async effective(tools: PhysicalTool[]): Promise<Array<Mapping & { tool: PhysicalTool }>> {
        await this.initialize();
        return this.registry.effective(tools);
    }
}
