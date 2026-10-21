const forbidden = new Set(['__proto__', 'prototype', 'constructor', '__dsh', 'then']);
const reserved = new Set(['tools', 'console', 'globalThis', 'Promise', 'Object', 'Array', 'JSON', 'Math', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Reflect', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Function', 'eval', 'Intl', 'ArrayBuffer', 'Uint8Array', 'undefined', 'NaN', 'Infinity']);

/** @brief Validate semantic paths before generating declarations or runtime objects. */
export function validatePath(path: string): void {
    const parts = path.split('.');
    if (parts.length < 2 || parts.some(p => !/^[a-zA-Z_$][\w$]*$/.test(p) || forbidden.has(p) || p.startsWith('__dsh')) || reserved.has(parts[0]!)) {
        throw new Error(`Invalid or reserved namespace path: ${path}`);
    }
    // Ask TypeScript's type renderer to quote property names; root keywords are excluded below.
    if (/^(?:const|let|var|function|class|new|delete|return|await|import|export|this|super|default|if|else|switch|case|try|catch|throw|while|for|do|break|continue|yield|void|typeof|instanceof|in|enum|extends|implements|interface|package|private|protected|public|static|with|debugger|null|true|false)$/.test(parts[0]!)) {
        throw new Error(`Reserved namespace root: ${parts[0]}`);
    }
}

/** @brief Encode physical names as readable, collision-free callable identifiers. */
export function toolName(id: string): string {
    const name = id.replace(/[^a-zA-Z0-9_]/gu, character => `$${character.codePointAt(0)!.toString(16)}$`);
    return !name || /^[0-9]/.test(name) || forbidden.has(name) || name.startsWith('__dsh') ? `$tool$${name}` : name;
}

