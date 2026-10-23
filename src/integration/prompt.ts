/** @brief Explain Text PTC execution, discovery controls and the language of user-facing answers. */
export function executionInstructions(marker: string, examplePath: string): string {
    return `Use the language of the user's latest request for all user-facing explanations, progress updates and final answers, unless the user explicitly requests another language. When the latest request contains only code or has no clear natural language, follow the user's language established in the conversation. API names, tool descriptions, runtime output and the language of these protocol instructions do not change the response language.

When execution is needed, end your response with exactly one js:exec or ts:exec fenced block. Use a line-leading triple-backtick opening and closing fence. Otherwise answer directly in prose. Keep private deliberation in the reasoning channel; visible prose must contain only a concise user-facing explanation or the answer. Never narrate internal planning, speculation, or draft code. Never write text after the exec block. An ordinary js/javascript/ts/typescript fence is only a displayed example and is NEVER executed. To perform an action, the opening fence MUST include the literal :exec suffix. Call every tool, including user questions and presentation tools, through the JavaScript runtime namespaces inside that block. Never emit native tool-call syntax or DSML tags. The tools namespace and all tools management commands are temporarily disabled; use only enabled command paths in the namespace directory.

Example of an actual execution (copy the opening fence exactly):
\x60\x60\x60js:exec
console.log(1 + 1);
\x60\x60\x60
After this block, wait for the execution result before making claims about its output. Do not replace execution with a code example or say that you will continue after code that has not run.

Each execution is a new strict AsyncFunction body supporting top-level await and explicit return. Local declarations never persist. Only explicit globalThis state persists within the live session process; a dsh restart or runtime reset loses that state. Use the native console interface for intermediate output.

IntelliSense is an on-demand protocol, not a JavaScript function. Before the first use of a command whose signature has not been supplied in this conversation, you MUST request its signature instead of guessing its name, arguments or return type. Write the literal ${marker} immediately after the command path in an OPEN exec block, then STOP the response immediately without a closing fence, parentheses or any trailing explanation. To discover members, place the marker after a namespace and its dot. The marker is a control token, never a string or comment. Do not escape or explain it in user-facing prose.
Example signature request (the response ends immediately after the marker):
\x60\x60\x60js:exec
return await ${examplePath}${marker}

Completion data will be supplied before you continue the remaining code. Continue exactly from the supplied prefix, then close the exec fence when the program is complete. You may request more completion data for another unknown path.
Additional controls inside exec blocks: <|LINEBREAK|> ends the response and requests continuation on a new line; <|BREAK|> abandons the current program without executing it. Use them only for those purposes. Never invent other protocol markers. Continue using the user's language after execution.`;
}

/** @brief Render only available command names as a deterministic read-only tree without guessing signatures. */
export function namespaceDirectory(paths: readonly string[]): string {
    type NamespaceTree = Map<string, NamespaceTree>;
    const nodes: NamespaceTree = new Map();
    for (const path of [...new Set(paths)].sort()) {
        let children = nodes;
        for (const part of path.split('.')) {
            if (!children.has(part)) children.set(part, new Map());
            children = children.get(part)!;
        }
    }
    const lines: string[] = [];
    /** @brief Walk trusted command path components without including tool-supplied descriptions. */
    function visit(children: NamespaceTree, indent: string): void {
        const entries = [...children];
        entries.forEach(([name, child], index) => {
            const last = index === entries.length - 1;
            lines.push(`${indent}${last ? '└── ' : '├── '}${name}`);
            visit(child, indent + (last ? '    ' : '│   '));
        });
    }
    visit(nodes, '');
    return `## 命名空间\n\nRead-only enabled command namespace tree. Names are not signatures; request IntelliSense before using an unknown command. The tools namespace is temporarily disabled and omitted.\n\n\x60\x60\x60text\n${lines.join('\n')}\n\x60\x60\x60`;
}
