import { ptcToolName } from '../runtime/builtins.js';
import { namespaceDeclaration, type NamespaceDeclaration } from './declaration.js';
export { callableDeclaration } from './declaration.js';

/** @brief Select the initial command instructions from the configured presentation mode. */
export function executionInstructions(mode: 'native' | 'ptc', discoveryAvailable = true): string {
    if (mode === 'native' && !discoveryAvailable) return '';
    const shared = discoveryAvailable ? `Use tools.inspect to discover namespace commands.\n` : '';
    if (mode === 'native') return `${shared}Call native DSML tools with named arguments. Mounted command names start with ns_ and use __ for namespace dots, such as ns_tools__inspect for tools.inspect. Query an exact command path to add that command to the available tools; namespace member queries only list members and their briefs. Use the callable names and argument schemas provided by the tool schemas.`;
    return `${shared}Call ${ptcToolName} with code (an async TypeScript/JavaScript function body) and description (a concise description of the program).
Use await for asynchronous calls and return to provide a result. You may attach variables to globalThis to share state between executions within this conversation. The VM may restart and lose all attached state; continuity is not guaranteed. Function-local declarations do not persist between executions. Runtime globals, including console, are available independently of the namespace tree. Tool-call rejections are ToolCallError instances with a toolName property.`;
}

/** @brief One prompt-visible namespace or command with a Profile-owned brief. */
export type NamespaceHint = NamespaceDeclaration;

/** @brief Describe native brief pins and their namespaces without publishing callable schemas. */
export function nativeDirectory(hints: readonly NamespaceHint[], discoveryAvailable = true): string {
    if (!hints.length) return '';
    const members = [...hints].sort((a, b) => a.path.localeCompare(b.path)).map(hint => ({
        path: hint.path,
        ...(hint.description?.trim() ? { brief: hint.description } : {}),
        ...(hint.namespace ? { namespace: true } : {}),
    }));
    return `Current partial namespace structure:\n\n${discoveryAvailable ? 'Query tools.inspect with an exact command path to add it to the available tools.\n\n' : ''}${JSON.stringify({ members }, null, 2)}`;
}

/** @brief Render the partial Profile selection including full declarations only for detailed pins. */
export function namespaceDirectory(hints: readonly (string | NamespaceHint)[], discoveryAvailable = true): string {
    const tree = namespaceDeclaration(hints.map(hint => typeof hint === 'string' ? { path: hint } : hint));
    return `Current partial namespace structure:\n\n${discoveryAvailable ? "Query tools.inspect using the configured calling convention to view namespace members and command signatures.\n\n" : ""}\x60\x60\x60ts:namespace\n${tree}\n\x60\x60\x60`;
}
