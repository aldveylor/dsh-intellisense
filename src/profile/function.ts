import type { FunctionPresentation } from './namespace/node.js';
import type { PresentationMode } from '../integration/presentation.js';
import type { ToolBrief, Profiles } from './catalog/profile_tree.js';
import { EditableNode, type ProfileNode, type ProfileCheckContext } from './node.js';
import { ProfilePermissionError, UnknownCommandError } from '../error.js';
import type { FunctionNode, ProfileTreeNode } from './catalog/profile_node.js';

/** @brief Data sources available to concrete functions that expose preloaded values. */
export interface FunctionValues {
    /** @brief Read physical tool summaries, session mount paths and global usage. */
    toolBriefs(): Promise<ToolBrief[]>;
    profileNames(): Promise<Profiles>;
}

/** @brief Portable function editing contract. */
export interface ProfileFunction extends ProfileNode {
    readonly type: 'function';
    readonly tool: string | undefined;
    /** @brief Identify a discovery function through its concrete implementation. */
    readonly discovery?: boolean;
    readonly refresh?: 'call' | 'revision';
    /** @brief Optionally supply the concrete function's language contract. */
    presentation?(schema: Record<string, unknown>, mode: PresentationMode, discoveryAvailable: boolean): FunctionPresentation | undefined;
    /** @brief Optionally supply a value preloaded into the PTC VM. */
    readValue?(source: FunctionValues): Promise<unknown>;
    /** @brief Bind an exact physical tool identity. */
    setTool(tool: string): this;
    /** @brief Set the Profile-specific summary. */
    setDescription(value: string | undefined): this;
    /** @brief Set requested prompt visibility. */
    setFixedLevel(value: 0 | 1 | 2): this;
    serialize(): FunctionNode;
}

/** @brief Class implementation of a portable function interface. */
export class EditableFunction extends EditableNode implements ProfileFunction {
    readonly type = 'function';
    private binding?: string;
    private description?: string;

    constructor(name = '', data?: FunctionNode) {
        super(name);
        if (data) { this.restore(data); this.binding = data.function.tool; this.description = data.function.doc; }
    }

    get tool(): string | undefined { return this.binding; }

    /** @brief Hydrate function data while retaining the actual provider implementation class. */
    override copyNode(value: ProfileTreeNode): this {
        if (value.type !== 'function') throw new ProfilePermissionError(`Protected function cannot be replaced: ${this.memberName}`);
        const node = super.copyNode(value);
        node.binding = value.function.tool;
        node.description = value.function.doc;
        return node;
    }

    /** @brief Ordinary function validation checks physical identity, hidden/fixed attributes and existing bindings. */
    check(context: ProfileCheckContext, _path = '', original?: ProfileTreeNode): void {
        const existing = original?.type === 'function' && original.function.tool === this.tool;
        const addition = context.addition(this.tool!);
        if (!existing && (!context.commands.has(this.tool!) || context.owns?.(this.tool!) || addition.hidden)) throw new UnknownCommandError(this.tool!);
    }

    /** @brief Bind an exact physical tool identity, including plugin-owned fixed tools. */
    setTool(tool: string): this {
        if (!tool.trim()) throw new Error('Invalid physical tool identity');
        this.binding = tool;
        return this;
    }

    /** @brief Set the Profile-specific function summary. */
    setDescription(value: string | undefined): this { if (!this.permissions.commentable && value !== this.description) throw new ProfilePermissionError(`Node documentation cannot be changed: ${this.memberName}`); this.description = value; return this; }

    /** @brief Set the function's requested prompt visibility. */
    setFixedLevel(value: 0 | 1 | 2): this { if (!this.permissions.availableFixLevels.includes(value)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${this.memberName}`); this.settings.fixedLevel = value; return this; }

    serialize(): FunctionNode {
        if (!this.binding) throw new Error(`Function has no physical tool: ${this.memberName}`);
        return structuredClone({ ...this.settings, type: this.type, function: { tool: this.binding, ...(this.description === undefined ? {} : { doc: this.description }) } });
    }
}
