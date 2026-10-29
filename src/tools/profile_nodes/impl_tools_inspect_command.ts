import { ImplToolsCommand } from './impl_tools_command.js';
import { nodePermissions, type Permission } from '../../profile/namespace/node.js';
import type { CommandNode, ProfileTreeNode } from '../../profile/catalog/profile_node.js';

/** @brief Discovery uses the builtin command policy and always retains detailed pinning. */
export class ImplToolsInspectCommand extends ImplToolsCommand {
    constructor(name: string, tool: string, data: CommandNode) { super(name, tool, { ...data, fixedLevel: 2 }); }

    /** @brief Hydration preserves the required detailed discovery level. */
    override copyNode(value: ProfileTreeNode): this { return super.copyNode({ ...value, fixedLevel: 2 } as CommandNode); }

    override get permissions(): Permission { return nodePermissions('leaf', { ...super.permissions, availableFixLevels: [2] }); }

    /** @brief Differential save restores the required discovery pin before patch validation. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode { return { ...super.normalize(value), fixedLevel: 2 } as CommandNode; }
}
