import type { TreeRenderer } from './tree_node.js';
import { TreeNode } from './tree_node.js';
import type { NamespaceTreeNode } from './namespace_tree_node.js';
import type { Mapping, PhysicalTool } from '../../../registry/registry.js';
import type { ProvidedCommand } from '../tree_provider.js';
import { fixLevel, type NodeType, type SerializedNode } from '../../../namespace/node.js';

/** @brief An independently editable mounting path for a physical command. */
export class CommandTreeNode extends TreeNode {
    readonly type: NodeType = 'leaf';

    constructor(name: string, parent: NamespaceTreeNode, readonly mapping?: Mapping, readonly description?: string, readonly physical?: PhysicalTool) { super(name, parent); }

    /** @brief Optional builtin contract used for command presentation and pinning. */
    get command(): ProvidedCommand | undefined { return undefined; }

    /** @brief Whether the command may be moved by the tree editor. */
    get draggable(): boolean { return this.permissions.movable && !this.mapping?.pinned; }

    /** @brief Resolve a saved pin using this node's available fix levels. */
    get level(): 0 | 1 | 2 { return fixLevel(this.permissions, this.command?.alwaysVisible ?? this.mapping?.alwaysVisible); }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions,
            command: { tool: this.mapping?.id ?? this.command?.id ?? this.path, schema: this.physical?.parameters ?? {}, output: this.physical?.output, doc: this.description ?? '' } });
    }

    /** @brief Render a command without requiring callers to inspect node flags. */
    render<T>(renderer: TreeRenderer<T>): T { return renderer.command(this); }
}

