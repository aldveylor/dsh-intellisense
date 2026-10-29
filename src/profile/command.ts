import type { CommandPresentation } from './namespace/node.js';
import type { PresentationMode } from '../integration/presentation.js';
import type { ToolBrief, Profiles } from './catalog/profile_tree.js';
import { EditableNode, type ProfileNode, type ProfileCheckContext } from './node.js';
import { ProfilePermissionError, UnknownCommandError } from '../error.js';
import type { CommandNode, ProfileTreeNode } from './catalog/profile_node.js';

/** @brief Data sources available to concrete commands that expose preloaded values. */
export interface CommandValues {
    /** @brief Read physical tool summaries, session mount paths and global usage. */
    toolBriefs(): Promise<ToolBrief[]>;
    profileNames(): Promise<Profiles>;
}

/** @brief Portable command editing contract. */
export interface ProfileCommand extends ProfileNode {
    readonly type: 'command';
    readonly tool: string | undefined;
    /** @brief Identify a discovery command through its concrete implementation. */
    readonly discovery?: boolean;
    readonly refresh?: 'call' | 'revision';
    /** @brief Optionally supply the concrete command's language contract. */
    presentation?(schema: Record<string, unknown>, mode: PresentationMode, discoveryAvailable: boolean): CommandPresentation | undefined;
    /** @brief Optionally supply a value preloaded into the PTC VM. */
    readValue?(source: CommandValues): Promise<unknown>;
    /** @brief Bind an exact physical tool identity. */
    setTool(tool: string): this;
    /** @brief Set the Profile-specific summary. */
    setDescription(value: string | undefined): this;
    /** @brief Set requested prompt visibility. */
    setFixedLevel(value: 0 | 1 | 2): this;
    serialize(): CommandNode;
}

/** @brief Class implementation of a portable command interface. */
export class EditableCommand extends EditableNode implements ProfileCommand {
    readonly type = 'command';
    private binding?: string;
    private description?: string;

    constructor(name = '', data?: CommandNode) {
        super(name);
        if (data) { this.restore(data); this.binding = data.command.tool; this.description = data.command.doc; }
    }

    get tool(): string | undefined { return this.binding; }

    /** @brief Hydrate command data while retaining the actual provider implementation class. */
    override copyNode(value: ProfileTreeNode): this {
        if (value.type !== 'command') throw new ProfilePermissionError(`Protected command cannot be replaced: ${this.memberName}`);
        const node = super.copyNode(value);
        node.binding = value.command.tool;
        node.description = value.command.doc;
        return node;
    }

    /** @brief Ordinary command validation checks physical identity, hidden/fixed attributes and existing bindings. */
    check(context: ProfileCheckContext, _path = '', original?: ProfileTreeNode): void {
        const existing = original?.type === 'command' && original.command.tool === this.tool;
        const addition = context.addition(this.tool!);
        if (!existing && (!context.commands.has(this.tool!) || context.owns?.(this.tool!) || addition.hidden)) throw new UnknownCommandError(this.tool!);
    }

    /** @brief Bind an exact physical tool identity, including plugin-owned fixed tools. */
    setTool(tool: string): this {
        if (!tool.trim()) throw new Error('Invalid physical tool identity');
        this.binding = tool;
        return this;
    }

    /** @brief Set the Profile-specific command summary. */
    setDescription(value: string | undefined): this { if (!this.permissions.commentable && value !== this.description) throw new ProfilePermissionError(`Node documentation cannot be changed: ${this.memberName}`); this.description = value; return this; }

    /** @brief Set the command's requested prompt visibility. */
    setFixedLevel(value: 0 | 1 | 2): this { if (!this.permissions.availableFixLevels.includes(value)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${this.memberName}`); this.settings.fixedLevel = value; return this; }

    serialize(): CommandNode {
        if (!this.binding) throw new Error(`Command has no physical tool: ${this.memberName}`);
        return structuredClone({ ...this.settings, type: this.type, command: { tool: this.binding, ...(this.description === undefined ? {} : { doc: this.description }) } });
    }
}
