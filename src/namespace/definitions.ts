import { EditableSnapshot } from '../registry/profile/snapshot.js';
import type { ProfileSnapshot } from '../registry/profile/profile.js';
import type { NamespaceTreeNode } from '../registry/profile_node.js';
import type { ToolAddition, ToolsNamespace } from './service.js';
import { registerBuiltinDefinitions } from './builtin_profile.js';

/** @brief Own shared recursive node definitions and reversible physical-tool registrations. */
export class NamespaceDefinitions implements Pick<ToolsNamespace, 'setToolAddition'> {
    private additions = new Map<string, Map<object, ToolAddition>>();
    private initializers = new Set<(snapshot: ProfileSnapshot) => void>();
    private cachedTree?: NamespaceTreeNode;
    revision = 0;

    constructor(private readonly changed: () => void = () => {}) { registerBuiltinDefinitions(this); }

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

    /** @brief Install a recursive template initializer for every Profile projection. */
    registerProfileInitializer(initialize: (snapshot: ProfileSnapshot) => void): () => void {
        this.initializers.add(initialize);
        this.cachedTree = undefined;
        try { this.tree(); } catch (error) { this.initializers.delete(initialize); this.cachedTree = undefined; throw error; }
        this.touch();
        return () => { if (this.initializers.delete(initialize)) this.touch(); };
    }

    /** @brief Build one complete recursive definition tree without mutating stored preferences. */
    tree(_name = 'Default'): NamespaceTreeNode {
        let tree = this.cachedTree;
        if (!tree) {
            const snapshot = new EditableSnapshot();
            for (const initialize of this.initializers) initialize(snapshot);
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
