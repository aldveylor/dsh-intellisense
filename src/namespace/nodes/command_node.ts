import { nodePermissions, fixLevel, type Permission, type Node, type NodeType, type SerializedNode } from '../node.js';
import type { ManifestEntry } from '../namespace.js';
import type { CommandBinding } from '../../runtime/protocol.js';
import type { NamespaceNode } from './node.js';
import { namespaceDeclaration, callableDeclaration } from '../declaration.js';
import { parameters, resultField, nativeArgumentsFor, resultFor, commandDeclaration } from './command_contract.js';

/** @brief A resolved command owns its parent reference and callable contract. */
export class CommandNode implements Node, ManifestEntry {
    readonly type: NodeType = 'leaf';
    readonly tool: string;
    readonly schema: Record<string, unknown>;
    readonly output: unknown;
    readonly doc: string;
    readonly presentation: ManifestEntry['presentation'];

    constructor(readonly name: string, readonly parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, readonly permissions: Permission = nodePermissions('leaf'), readonly fixedLevel: 0 | 1 | 2 = 0, readonly provided = false) {
        this.tool = entry.tool;
        this.schema = entry.schema;
        this.output = entry.output;
        this.doc = entry.doc;
        this.presentation = entry.presentation;
    }

    get path(): string { return this.parent.path ? `${this.parent.path}.${this.name}` : this.name; }

    get disabled(): boolean { return this.parent.disabled; }

    /** @brief Data commands are preloaded rather than installed as PTC functions. */
    get preload(): boolean { return this.presentation?.preload ?? false; }

    /** @brief Ordinary commands have no additional source signature. */
    get signature(): string | undefined { return this.presentation?.signature; }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions, description: this.doc,
            preload: this.preload, fixedLevel: this.fixedLevel, command: { tool: this.tool, schema: this.schema, output: this.output, doc: this.doc } });
    }

    /** @brief Keep serialized commands independent of their parent graph. */
    toJSON(): SerializedNode { return this.serialize(); }

    /** @brief Resolve a requested pin against this command's available levels. */
    fixLevel(level: 0 | 1 | 2 = this.fixedLevel): 0 | 1 | 2 { return fixLevel(this.permissions, level); }

    /** @brief Compile the physical target and argument/result adapters before VM deployment. */
    binding(): CommandBinding {
        const fields = parameters(this);
        const result = resultField(this);
        return { path: this.path, tool: this.tool,
            parameters: this.presentation?.positional ? { kind: 'overloads', layouts: this.presentation.positional.map(layout => [...layout]) }
                : fields ? { kind: 'fields', fields: fields.map(field => field.name) } : { kind: 'object' },
            result: this.presentation?.discardResult ? { kind: 'discard' } : result ? { kind: 'field', field: result[0] } : { kind: 'identity' } };
    }

    /** @brief Validate named arguments against the native schema. */
    nativeArguments(input: unknown): unknown { return nativeArgumentsFor(this, input); }

    /** @brief Project a native result into the public namespace return value. */
    result(value: unknown): unknown { return this.presentation?.discardResult ? undefined : resultFor(this, value); }

    /** @brief Render the public positional declaration. */
    declaration(nested = true): string { return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: this.presentation ? callableDeclaration({ ...this.presentation, path: this.path, description: this.doc }) : commandDeclaration(this) }], false); }
}

