import { nodePermissions } from '../node.js';
import { CommandNode } from './command_node.js';
import type { NamespaceNode } from './node.js';
import { namespaceDeclaration, builtinDeclaration } from '../declaration.js';
import type { BuiltinCommand } from '../../runtime/builtins.js';

/** @brief A native environment function is a normal leaf with a declaration and no tool deployment. */
export class EnvironmentCommandNode extends CommandNode {
    constructor(name: string, parent: NamespaceNode, readonly contract: BuiltinCommand) {
        super(name, parent, { tool: contract.path, schema: {}, output: {}, doc: contract.description }, nodePermissions('leaf', { renamable: false, movable: false, removable: false }));
    }

    override get deployment(): 'environment' { return 'environment'; }

    override get signature(): string { return this.contract.signature; }

    override declaration(nested = true): string { return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: builtinDeclaration(this.contract) }], false); }
}

