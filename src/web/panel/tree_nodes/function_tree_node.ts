import type { TreeRenderer } from './tree_node.js';
import { TreeNode } from './tree_node.js';
import type { NamespaceTreeNode } from './namespace_tree_node.js';
import type { Mapping, PhysicalTool } from '../../../profile/catalog/registry.js';
import type { ProvidedFunction } from '../tree_provider.js';
import { fixLevel, type Permission, type NodeType, type SerializedNode } from '../../../profile/namespace/node.js';

/** @brief An independently editable mounting path for a physical function. */
export class FunctionTreeNode extends TreeNode {
    readonly type: NodeType = 'leaf';

    constructor(name: string, parent: NamespaceTreeNode, readonly mapping?: Mapping, readonly description?: string, readonly physical?: PhysicalTool, permissions?: Partial<Permission>) { super(name, parent, permissions); }

    /** @brief Optional builtin contract used for function presentation and pinning. */
    get function(): ProvidedFunction | undefined { return undefined; }

    /** @brief Whether the function may be moved by the tree editor. */
    get draggable(): boolean { return this.permissions.movable && !this.mapping?.pinned; }

    /** @brief Resolve a saved pin using this node's available fix levels. */
    get level(): 0 | 1 | 2 { return fixLevel(this.permissions, this.function?.alwaysVisible ?? this.mapping?.alwaysVisible); }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions,
            function: { tool: this.mapping?.id ?? this.function?.id ?? this.path, schema: this.physical?.parameters ?? {}, output: this.physical?.output, doc: this.description ?? '' } });
    }

    /** @brief Render a function without requiring callers to inspect node flags. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.function(this); }
}

