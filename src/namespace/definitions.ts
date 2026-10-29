import { EditableSnapshot } from '../registry/profile/snapshot.js';
import type { ProfileData } from '../registry/profile_tree.js';
import type { ProfileFactory, ProfileSnapshot } from '../registry/profile/profile.js';
import type { NamespaceTreeNode } from '../registry/profile_node.js';
import type { ProfileSaveEffect, ProfileSaveEvent, ToolsNamespace } from './service.js';
import { registerBuiltinDefinitions } from './builtin_profile.js';

/** @brief Own the initial Profile factory and completed-save observers. */
export class NamespaceDefinitions implements Pick<ToolsNamespace, 'createInitialProfile' | 'effect'> {
    private saveEffects = new Set<ProfileSaveEffect>();
    private profileFactory: ProfileFactory = () => new EditableSnapshot();
    private cachedTree?: NamespaceTreeNode;
    revision = 0;

    constructor(private readonly changed: () => void = () => {}) { registerBuiltinDefinitions(this); }

    /** @brief Register an ordered save processor with reversible lifetime. */
    effect(_event: 'save', handler: ProfileSaveEffect): () => void {
        this.saveEffects.add(handler);
        return () => { this.saveEffects.delete(handler); };
    }

    /** @brief Notify observers after persistence; observer results do not affect tool feedback. */
    async processSave(event: ProfileSaveEvent): Promise<void> {
        for (const handler of [...this.saveEffects]) await handler(event);
    }

    /** @brief Use one replaceable constructor for default Profiles and typed stored snapshots. */
    get createInitialProfile(): ProfileFactory { return this.profileFactory; }

    set createInitialProfile(factory: ProfileFactory) {
        if (typeof factory !== 'function') throw new Error('Invalid Profile factory');
        this.profileFactory = factory;
        this.touch();
    }

    /** @brief Hydrate data by cloning the concrete Profile returned by the no-argument initial factory. */
    profile(value: Pick<ProfileData, 'root' | 'brief'>): ProfileSnapshot { return this.createInitialProfile().clone(value); }

    /** @brief Build one complete recursive definition tree without mutating stored preferences. */
    tree(_name = 'Default'): NamespaceTreeNode {
        let tree = this.cachedTree;
        if (!tree) {
            const snapshot = this.createInitialProfile();
            tree = snapshot.serialize();
            this.cachedTree = tree;
        }
        return structuredClone(tree);
    }

    /** @brief Invalidate the serialized initial declaration after a factory change. */
    private touch(): void { this.cachedTree = undefined; this.revision++; this.changed(); }
}

/** @brief Immutable-by-convention defaults used by standalone tree and registry helpers. */
export const defaultNamespaceDefinitions = new NamespaceDefinitions();
