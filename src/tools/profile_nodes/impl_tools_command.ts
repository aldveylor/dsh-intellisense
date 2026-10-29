import { pluginCommands, projectBuiltin } from '../../runtime/builtins.js';
import { profileAnnotation } from '../../profile/catalog/profile_tree.js';
import type { CommandValues } from '../../profile/command.js';
import type { CommandPresentation } from '../../profile/namespace/node.js';
import type { PresentationMode } from '../../integration/presentation.js';
import { EditableCommand } from '../../profile/command.js';
import type { CommandNode, ProfileTreeNode } from '../../profile/catalog/profile_node.js';
import type { ProfileCheckContext } from '../../profile/node.js';
import { nodePermissions, type Permission } from '../../profile/namespace/node.js';
import { ProfilePermissionError } from '../../error.js';

/** @brief Shared implementation for builtin commands with identical structural and documentation restrictions. */
export class ImplToolsCommand extends EditableCommand {
    constructor(name: string, private readonly physicalTool: string, data: CommandNode) { super(name, data); }

    get discovery(): boolean { return this.physicalTool === pluginCommands.discoveryCommand.tool; }

    get refresh(): 'call' | 'revision' | undefined {
        return this.physicalTool === 'tools_profile_profiles' ? 'call' : this.physicalTool === 'tools_profile_tools' ? 'revision' : undefined;
    }

    /** @brief Builtin classes own signatures, overloads and preload behavior. */
    presentation(schema: Record<string, unknown>, mode: PresentationMode, discoveryAvailable: boolean): CommandPresentation {
        const command = pluginCommands.find(this.physicalTool)!;
        const source = command === pluginCommands.searchCommand
            ? pluginCommands.searchContract(((schema.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? []) : command;
        const projected = projectBuiltin(source, mode);
        return { ...projected, description: discoveryAvailable ? projected.description : projected.description.replace(projected.discoveryHint ?? '', '') };
    }

    /** @brief Read builtin values without attaching producers to namespace metadata. */
    async readValue(source: CommandValues): Promise<unknown> {
        if (this.physicalTool === 'tools_profile_annotation') return profileAnnotation;
        if (this.physicalTool === 'tools_profile_tools') return source.toolBriefs();
        if (this.physicalTool === 'tools_profile_profiles') return source.profileNames();
        return undefined;
    }

    /** @brief Stored snapshots cannot replace the provider's immutable physical identity or documentation. */
    override copyNode(value: ProfileTreeNode): this {
        if (value.type !== 'command') throw new ProfilePermissionError(`Protected command cannot be replaced: ${this.memberName}`);
        return super.copyNode({ ...value, command: this.serialize().command });
    }

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
