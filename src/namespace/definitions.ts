import { EditableSnapshot } from '../registry/profile/snapshot.js';
import type { ProfileData } from '../registry/profile_tree.js';
import type { ProfileFactory, ProfileSnapshot } from '../registry/profile/profile.js';
import type { NamespaceTreeNode } from '../registry/profile_node.js';
import type { ProfileSaveEffect, ProfileSaveEvent, ToolAddition, ToolsNamespace } from './service.js';
import type { NamespaceImplementation } from './nodes/context.js';
import { registerBuiltinDefinitions } from './builtin_profile.js';

/** @brief Own shared recursive node definitions and reversible physical-tool registrations. */
export class NamespaceDefinitions implements Pick<ToolsNamespace, 'setToolAddition' | 'setNamespaceImplementation' | 'createInitialProfile' | 'effect'> {
    private implementations = new Map<string, Map<object, NamespaceImplementation>>();
    private saveEffects = new Set<ProfileSaveEffect>();
    private additions = new Map<string, Map<object, ToolAddition>>();
    private profileFactory: ProfileFactory = () => new EditableSnapshot();
    private cachedTree?: NamespaceTreeNode;
    revision = 0;

    constructor(private readonly changed: () => void = () => {}) { registerBuiltinDefinitions(this); }

    /** @brief Layer provider implementations without making the tree builder recognize their names. */
    setNamespaceImplementation(path: string, implementation: NamespaceImplementation): () => void {
        if (!path || typeof implementation !== 'function') throw new Error('Invalid namespace implementation');
        const token = {};
        let layers = this.implementations.get(path);
        if (!layers) this.implementations.set(path, layers = new Map());
        layers.set(token, implementation);
        this.touch();
        return () => { if (layers.delete(token)) { if (!layers.size) this.implementations.delete(path); this.touch(); } };
    }

    /** @brief Resolve the current implementation of a namespace path. */
    implementation(path: string): NamespaceImplementation | undefined { return [...this.implementations.get(path)?.values() ?? []].at(-1); }

    /** @brief Register an ordered save processor with reversible lifetime. */
    effect(_event: 'save', handler: ProfileSaveEffect): () => void {
        this.saveEffects.add(handler);
        return () => { this.saveEffects.delete(handler); };
    }

    /** @brief Run effects on detached transaction data before any persistent write. */
    async processSave(event: ProfileSaveEvent): Promise<void> {
        for (const handler of [...this.saveEffects]) await handler(event);
    }

    /** @brief Register an attribute layer and restore the previous layer on disposal. */
    setToolAddition(tool: string, addition: ToolAddition): () => void {
        if (!tool.trim() || (addition.fixed !== undefined && typeof addition.fixed !== 'boolean') || (addition.hidden !== undefined && typeof addition.hidden !== 'boolean') || (addition.ptcDescription !== undefined && typeof addition.ptcDescription !== 'string')) throw new Error('Invalid tool addition');
        const token = {};
        let layers = this.additions.get(tool);
        if (!layers) this.additions.set(tool, layers = new Map());
        layers.set(token, { ...addition });
        this.touch();
        return () => { if (layers.delete(token)) { if (!layers.size) this.additions.delete(tool); this.touch(); } };
    }

    /** @brief Resolve currently registered physical-tool attributes. */
    addition(tool: string): ToolAddition { return Object.assign({}, ...this.additions.get(tool)?.values() ?? []); }

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

    /** @brief Invalidate projected trees and tool catalogs after registration changes. */
    private touch(): void { this.cachedTree = undefined; this.revision++; this.changed(); }
}

/** @brief Immutable-by-convention defaults used by standalone tree and registry helpers. */
export const defaultNamespaceDefinitions = new NamespaceDefinitions();
