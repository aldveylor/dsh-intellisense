import { nodePermissions, type Permission } from '../node.js';
import { CommandNode } from './command_node.js';
import type { NamespaceNode } from './node.js';
import type { ManifestEntry } from '../namespace.js';
import { pluginCommands, type BuiltinTool } from '../../runtime/builtins.js';
import type { CommandBinding } from '../../runtime/protocol.js';
import { namespaceDeclaration, builtinDeclaration } from '../declaration.js';

/** @brief Restricted server commands own adapters and policies without exposing their class to clients. */
export class InnerCommandNode extends CommandNode {
    constructor(name: string, parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, readonly builtin: BuiltinTool, permissions: Partial<Permission> = {}) {
        super(name, parent, entry, nodePermissions('leaf', { renamable: false, movable: false, removable: false, ...permissions }));
    }

    override get preload(): boolean { return this.builtin.preload ?? false; }

    override get signature(): string { return this.builtin.signature; }

    override binding(): CommandBinding {
        const binding = super.binding();
        if (this.builtin.rest) binding.parameters = { kind: 'rest', field: this.builtin.rest };
        else if (this.builtin.positional) binding.parameters = { kind: 'overloads', layouts: this.builtin.positional.map(layout => [...layout]) };
        if (this.builtin.discardResult) binding.result = { kind: 'discard' };
        return binding;
    }

    override result(value: unknown): unknown { return this.builtin.discardResult ? undefined : super.result(value); }

    override declaration(nested = true): string {
        const contract = this.tool === 'tools_search' ? pluginCommands.searchContract(((this.schema.properties as Record<string, { enum?: string[] }> | undefined)?.method?.enum) ?? []) : this.builtin;
        return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: builtinDeclaration(contract) }], false);
    }
}

