import { decodeHTML } from 'entities';
import type { BuiltinCommand, BuiltinTool } from '../runtime/builtins.js';

/** @brief One namespace, shallow command, typed value or complete command declaration. */
export interface NamespaceDeclaration {
    path: string;
    namespace?: boolean;
    description?: string;
    declaration?: string;
    valueType?: string;
}

/** @brief A shared namespace node assembled from flat semantic paths. */
interface DeclarationNode extends Omit<NamespaceDeclaration, 'path'> { children: Map<string, DeclarationNode> }

/** @brief Render every declaration surface from the same deterministic namespace tree. */
export function namespaceDeclaration(items: readonly NamespaceDeclaration[], ambient = true): string {
    const root: DeclarationNode = { children: new Map() };
    for (const { path, ...item } of items) {
        let node = root;
        for (const part of path.split('.').filter(Boolean)) {
            if (!node.children.has(part)) node.children.set(part, { children: new Map() });
            node = node.children.get(part)!;
        }
        Object.assign(node, item);
    }
    const lines: string[] = ambient ? ['declare namespace global {'] : [];
    /** @brief Keep comments and declarations within their prompt fences. */
    const clean = (text: string): string => decodeHTML(text).replace(/[`\r\n\u2028\u2029]/g, ' ').replaceAll('*/', '* /').replaceAll('<|', '< |').trim();
    /** @brief Render reserved method names as object members, since namespace function bindings cannot use keywords. */
    function objectMembers(node: DeclarationNode, indent: string): void {
        for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
            if (child.description && !child.declaration) lines.push(`${indent}/** @brief ${clean(child.description)} */`);
            if (child.namespace || child.children.size) {
                lines.push(`${indent}${name}: {`);
                objectMembers(child, indent + '  ');
                lines.push(`${indent}};`);
            } else if (child.declaration) {
                lines.push(...child.declaration.trim().replaceAll('`', '\u02cb').replaceAll('<|', '< |').replace(/\bfunction (\w+)\(/g, '$1(').split('\n').map(line => indent + line));
            } else lines.push(`${indent}readonly ${name}: ${child.valueType ?? 'Function'};`);
        }
    }
    /** @brief Render namespaces and leaves in deterministic name order. */
    function visit(node: DeclarationNode, indent: string): void {
        for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
            const brief = child.description ? `  // ${clean(child.description)}` : '';
            if ((child.namespace || child.children.size) && [...child.children.keys()].some(member => ['delete', 'switch'].includes(member))) {
                lines.push(`${indent}const ${name}: {${brief}`);
                objectMembers(child, indent + '  ');
                lines.push(`${indent}};`);
            } else if (child.namespace || child.children.size) {
                lines.push(`${indent}namespace ${name} {${brief}`);
                visit(child, indent + '  ');
                lines.push(`${indent}}`);
            } else if (child.declaration) {
                lines.push(...child.declaration.trim().replaceAll('`', '\u02cb').replaceAll('<|', '< |').split('\n').map(line => indent + line));
            } else {
                if (child.description) lines.push(`${indent}/** @brief ${clean(child.description)} */`);
                lines.push(`${indent}const ${name}: ${child.valueType ?? 'Function'};`);
            }
        }
    }
    visit(root, ambient ? '  ' : '');
    if (ambient) lines.push('}');
    return lines.join('\n');
}

/** @brief Build documented builtin declarations from their shared runtime signatures. */
export function builtinDeclaration(command: BuiltinCommand & Partial<Pick<BuiltinTool, 'preload' | 'overloads'>>): string {
    const names: string[] = [];
    let depth = 0;
    let start = 1;
    const end = command.signature.lastIndexOf(') =>');
    for (let index = 1; index <= end; index++) {
        const char = command.signature[index];
        if (index === end || (char === ',' && depth === 0)) {
            const name = command.signature.slice(start, index).trim().match(/^(?:\.\.\.)?(\w+)/)?.[1];
            if (name) names.push(name);
            start = index + 1;
        } else if ('{[('.includes(char!)) depth++;
        else if ('}])'.includes(char!)) depth--;
    }
    const descriptions: Record<string, string> = {
        keywords: 'Keywords to search with OR semantics.', method: 'Registered search method; defaults to the configured engine.',
        max_results: 'Maximum results; defaults to 10.', target: 'Search name, description, parameters, or all (default).',
        namespace_path: 'Namespace subtree; an empty string searches the entire tree (default).',
    };
    /** @brief Keep builtin documentation inside its comment and prompt fence. */
    const clean = (text: string): string => decodeHTML(text).replaceAll('*/', '* /').replace(/[`\r\n\u2028\u2029]/g, ' ').replace(/<\|/g, '< |');
    const docs = [` * @brief ${clean(command.description)}`, ...names.map(name => ` * @param ${name} ${command.parameterDocs?.[name] ?? descriptions[name] ?? 'Command arguments.'}`)];
    const signatures = command.preload ? [`() => Promise<${command.signature}>`] : [command.signature, ...command.overloads ?? []];
    return `/**\n${docs.join('\n')}\n */\n${signatures.map(signature => `function ${command.path.split('.').at(-1)}${signature.replace(' => ', ': ')};`).join('\n')}`;
}
