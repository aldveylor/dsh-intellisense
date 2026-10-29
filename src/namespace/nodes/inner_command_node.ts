import { nodePermissions, type Permission } from '../node.js';
import { CommandNode } from './command_node.js';
import type { NamespaceNode } from './node.js';
import type { ManifestEntry } from '../namespace.js';
import { pluginCommands, type BuiltinCommand } from '../../runtime/builtins.js';
import type { CommandBinding } from '../../runtime/protocol.js';
import { namespaceDeclaration, builtinDeclaration } from '../declaration.js';

/** @brief Restricted server commands own adapters and policies without exposing their class to clients. */
export class InnerCommandNode extends CommandNode {
    constructor(name: string, parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, readonly builtin: BuiltinCommand, permissions: Partial<Permission> = {}, fixedLevel: 0 | 1 | 2 = 0, provided = true) {
        let root = parent;
        while (root.parent) root = root.parent;
        const discovery = root.resolve(['tools', 'inspect']);
        if (builtin.tool !== pluginCommands.discoveryCommand.tool && (!discovery || discovery.disabled)) {
            const description = builtin.description.replace(builtin.discoveryHint ?? '', '');
            builtin = { ...builtin, description };
            entry = { ...entry, doc: description };
        }
        super(name, parent, entry, nodePermissions('leaf', { renamable: false, commentable: false, movable: false, removable: false, ...permissions }), fixedLevel, provided);
    }

    override get preload(): boolean { return this.builtin.preload ?? false; }

    override get signature(): string { return this.builtin.signature; }

    override binding(): CommandBinding {
        const binding = super.binding();
        if (this.builtin.positional) binding.parameters = { kind: 'overloads', layouts: this.builtin.positional.map(layout => [...layout]) };
        if (this.builtin.discardResult) binding.result = { kind: 'discard' };
        return binding;
    }

    override result(value: unknown): unknown { return this.builtin.discardResult ? undefined : super.result(value); }

    override declaration(nested = true): string {
        return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: builtinDeclaration(this.builtin) }], false);
    }
}

