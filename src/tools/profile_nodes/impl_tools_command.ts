import { EditableCommand } from '../../registry/profile/command.js';
import type { CommandNode, ProfileTreeNode } from '../../registry/profile_node.js';
import type { ProfileCheckContext } from '../../registry/profile/node.js';
import { nodePermissions, type Permission } from '../../namespace/node.js';
import { ProfilePermissionError } from '../../error.js';

/** @brief Shared implementation for builtin commands with identical structural and documentation restrictions. */
export class ImplToolsCommand extends EditableCommand {
    constructor(name: string, private readonly physicalTool: string, data: CommandNode) { super(name, data); }

    /** @brief Builtin instances retain their provider-owned physical identity even when unavailable in this scope. */
    override check(_context: ProfileCheckContext): void {
        if (this.tool !== this.physicalTool) throw new ProfilePermissionError(`Protected command cannot be replaced: ${this.memberName}`);
    }

    override get permissions(): Permission { return nodePermissions('leaf', { renamable: false, movable: false, removable: false, commentable: false }); }

    /** @brief A builtin physical identity cannot be rebound. */
    override setTool(tool: string): this {
        if (tool !== this.physicalTool) throw new ProfilePermissionError(`Protected command cannot be replaced: ${this.memberName}`);
        return this;
    }

    /** @brief Provider declarations remain authoritative when a caller attempts to change permissions. */
    override setPermissions(_value: Partial<Permission>): this { throw new ProfilePermissionError(`Node permissions cannot be changed: ${this.memberName}`); }

    /** @brief Save corrects immutable command identity and documentation before applying a difference. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        const original = this.serialize();
        return value.type === 'command' ? { ...value, command: original.command } : original;
    }

    override serialize(): CommandNode { return { ...super.serialize(), permissions: this.permissions }; }
}
