import { nodePermissions, fixLevel, type Permission, type Node, type NodeType, type SerializedNode } from '../node.js';
import type { ManifestEntry } from '../namespace.js';
import type { CommandBinding } from '../../runtime/protocol.js';
import type { NamespaceNode } from './namespace_node.js';
import { namespaceDeclaration } from '../namespace_declaration.js';
import { parameters, resultField, nativeArgumentsFor, resultFor, commandDeclaration } from './command_contract.js';

/** @brief A resolved command owns its parent reference and callable contract. */
export class CommandNode implements Node, ManifestEntry {
    readonly type: NodeType = 'leaf';
    readonly tool: string;
    readonly argMap?: Record<string, string>;
    readonly schema: Record<string, unknown>;
    readonly output: unknown;
    readonly doc: string;

    constructor(readonly name: string, readonly parent: NamespaceNode, entry: Omit<ManifestEntry, 'path'>, readonly permissions: Permission = nodePermissions('leaf')) {
        this.tool = entry.tool;
        this.argMap = entry.argMap;
        this.schema = entry.schema;
        this.output = entry.output;
        this.doc = entry.doc;
    }

    get path(): string { return this.parent.path ? `${this.parent.path}.${this.name}` : this.name; }

    get disabled(): boolean { return this.parent.disabled; }

    /** @brief Environment commands are described but never deployed as tool proxies. */
    get deployment(): 'tool' | 'environment' { return 'tool'; }

    /** @brief Data commands are preloaded rather than installed as PTC functions. */
    get preload(): boolean { return false; }

    /** @brief Ordinary commands have no additional source signature. */
    get signature(): string | undefined { return undefined; }

    serialize(): SerializedNode {
        return structuredClone({ type: this.type, name: this.name, permissions: this.permissions, description: this.doc, signature: this.signature,
            deployment: this.deployment, preload: this.preload, command: { tool: this.tool, argMap: this.argMap, schema: this.schema, output: this.output, doc: this.doc } });
    }

    /** @brief Keep serialized commands independent of their parent graph. */
    toJSON(): SerializedNode { return this.serialize(); }

    /** @brief Resolve a requested pin against this command's available levels. */
    fixLevel(level: 0 | 1 | 2 = 0): 0 | 1 | 2 { return fixLevel(this.permissions, level); }

    /** @brief Compile the physical target and argument/result adapters before VM deployment. */
    binding(): CommandBinding {
        const fields = parameters(this);
        const result = resultField(this);
        return { path: this.path, tool: this.tool,
            parameters: fields ? { kind: 'fields', fields: fields.map(field => field.native) } : { kind: 'object', aliases: { ...this.argMap } },
            result: result ? { kind: 'field', field: result[0] } : { kind: 'identity' } };
    }

    /** @brief Translate named alias arguments into the native schema. */
    nativeArguments(input: unknown): unknown { return nativeArgumentsFor(this, input); }

    /** @brief Project a native result into the public namespace return value. */
    result(value: unknown): unknown { return resultFor(this, value); }

    /** @brief Render the public positional declaration. */
    declaration(nested = true): string { return namespaceDeclaration([{ path: nested ? this.path : this.name, declaration: commandDeclaration(this) }], false); }
}

