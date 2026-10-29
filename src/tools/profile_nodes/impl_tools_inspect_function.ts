import { ImplToolsFunction } from './impl_tools_function.js';
import { nodePermissions, type Permission } from '../../profile/namespace/node.js';
import type { FunctionNode, ProfileTreeNode } from '../../profile/catalog/profile_node.js';

/** @brief Discovery uses the builtin function policy and always retains detailed pinning. */
export class ImplToolsInspectFunction extends ImplToolsFunction {
    constructor(name: string, tool: string, data: FunctionNode) { super(name, tool, { ...data, fixedLevel: 2 }); }

    /** @brief Hydration preserves the required detailed discovery level. */
    override copyNode(value: ProfileTreeNode): this { return super.copyNode({ ...value, fixedLevel: 2 } as FunctionNode); }

    override get permissions(): Permission { return nodePermissions('leaf', { ...super.permissions, availableFixLevels: [2] }); }

    /** @brief Differential save restores the required discovery pin before patch validation. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode { return { ...super.normalize(value), fixedLevel: 2 } as FunctionNode; }
}
