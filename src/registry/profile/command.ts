import { EditableNode, type ProfileNode } from './node.js';
import type { CommandNode } from '../profile_node.js';

/** @brief Portable command editing contract. */
export interface ProfileCommand extends ProfileNode {
    readonly type: 'command';
    readonly tool: string | undefined;
    /** @brief Bind an exact physical tool identity. */
    setTool(tool: string): this;
    /** @brief Set the Profile-specific summary. */
    setDescription(value: string): this;
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

    /** @brief Bind an exact physical tool identity, including plugin-owned fixed tools. */
    setTool(tool: string): this {
        if (!tool.trim()) throw new Error('Invalid physical tool identity');
        this.binding = tool;
        return this;
    }

    /** @brief Set the Profile-specific command summary. */
    setDescription(value: string): this { this.description = value; return this; }

    /** @brief Set the command's requested prompt visibility. */
    setFixedLevel(value: 0 | 1 | 2): this { this.settings.fixedLevel = value; return this; }

    serialize(): CommandNode {
        if (!this.binding) throw new Error(`Command has no physical tool: ${this.name}`);
        return structuredClone({ ...this.settings, type: this.type, command: { tool: this.binding, ...(this.description === undefined ? {} : { doc: this.description }) } });
    }
}
