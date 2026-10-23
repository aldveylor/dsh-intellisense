import { decodeHTML } from 'entities';

/** @brief Explain Text PTC execution, discovery controls and the language of user-facing answers. */
export function executionInstructions(marker: string, examplePath = 'std.cwd'): string {
    return `Use the language of the user's human-authored request for all user-facing explanations, progress updates and final answers, unless the user explicitly requests another language. Synthetic user-role continuation messages are not new human requests.

When execution is needed, end your response with exactly one js:exec or ts:exec fenced block. Use a line-leading triple-backtick opening and closing fence. Otherwise answer directly in prose. Keep private deliberation in the reasoning channel; visible prose must contain only a concise user-facing explanation or the answer. Never narrate internal planning, speculation, or draft code. Never write text after the exec block. An ordinary js/javascript/ts/typescript fence is only a displayed example and is NEVER executed. To perform an action, the opening fence MUST include the literal :exec suffix. Call every tool, including user questions and presentation tools, through the JavaScript runtime namespaces inside that block. Never emit native tool-call syntax or DSML tags.

Example of an actual execution (copy the opening fence exactly):
\x60\x60\x60js:exec
console.log(1 + 1);
\x60\x60\x60
After this block, wait for the execution result before making claims about its output. Do not replace execution with a code example or say that you will continue after code that has not run.

Each execution is a new strict AsyncFunction body supporting top-level await and explicit return. Local declarations never persist. Only explicit globalThis state persists within the live session process; a dsh restart or runtime reset loses that state. Use the native console interface for intermediate output.

IntelliSense is an on-demand protocol, not a JavaScript function. Before the first use of a command whose signature has not been supplied in this conversation, you MUST request its signature instead of guessing its name, arguments or return type. Write the literal ${marker} immediately after the command path in an OPEN exec block, then STOP the response immediately without a closing fence, parentheses or any trailing explanation. To discover members, place the marker after a namespace and its dot. The marker is a control token, never a string or comment. Do not escape or explain it in user-facing prose.
Example signature request (the outer four-backtick fence only delimits this example; output the inner three-backtick opening and the expression):
\x60\x60\x60\x60text
\x60\x60\x60js:exec
return await ${examplePath}${marker}
\x60\x60\x60\x60
The exec fence is intentionally unclosed. STOP the response immediately without a closing fence. Never output the marker alone: it must follow the command path inside the open exec block.
Completion data will be supplied before you continue the remaining code. Continue exactly from the supplied prefix, then close the exec fence when the program is complete. You may request more completion data for another unknown path.
Additional controls inside exec blocks: <|LINEBREAK|> ends the response and requests continuation on a new line; <|BREAK|> abandons the current program without executing it. Use them only for those purposes. Never invent other protocol markers. Continue using the user's language after execution.`;
}

/** @brief One prompt-visible namespace or command with a Profile-owned brief. */
export interface NamespaceHint { path: string; description?: string; namespace?: boolean }

/** @brief Render the partial Profile selection without exposing signatures or unpinned commands. */
export function namespaceDirectory(hints: readonly (string | NamespaceHint)[]): string {
    interface Node { children: Map<string, Node>; description?: string; namespace?: boolean }
    const root: Node = { children: new Map(), namespace: true };
    for (const hint of hints) {
        const item = typeof hint === 'string' ? { path: hint } : hint;
        let node = root;
        for (const part of item.path.split('.')) {
            if (!node.children.has(part)) node.children.set(part, { children: new Map() });
            node = node.children.get(part)!;
        }
        node.description = item.description;
        node.namespace = item.namespace;
    }
    const lines = ['namespace global {'];
    /** @brief Keep Profile briefs on a single comment line and prevent fence injection. */
    function brief(text?: string): string {
        const value = text === undefined ? undefined : decodeHTML(text).replace(/[`\r\n\u2028\u2029]/g, ' ').replace(/<\|/g, '< |').trim();
        return value ? `  // ${value}` : '';
    }
    /** @brief Render nested namespace declarations in deterministic name order. */
    function visit(node: Node, indent: string): void {
        for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
            if (child.namespace || child.children.size) {
                lines.push(`${indent}namespace ${name} {${brief(child.description)}`);
                visit(child, indent + '    ');
                lines.push(`${indent}}`);
            } else lines.push(`${indent}${name}: Function;${brief(child.description)}`);
        }
    }
    visit(root, '    ');
    lines.push('}');
    return `## Namespaces\n\nCurrent partial namespace structure:\n\nRequire IntelliSense to view the namespace tree and the details of each command.\n\n\x60\x60\x60ts:namespace\n${lines.join('\n')}\n\x60\x60\x60`;
}
