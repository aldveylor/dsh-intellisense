import { z } from 'zod';

/** @brief Structured validation failure with compact field paths instead of a Zod union tree. */
export class ValidationError extends Error {
    readonly code = 'invalid_arguments';

    constructor(readonly issues: { path: string; message: string }[]) {
        super(JSON.stringify({ code: 'invalid_arguments', issues }));
        this.name = 'ValidationError';
    }
}

/** @brief A forbidden edit to a server-owned Profile node. */
export class ProfilePermissionError extends Error {
    readonly code = 'profile_permission_denied';

    constructor(message: string) { super(message); this.name = 'ProfilePermissionError'; }
}

/** @brief A requested catalog Profile is unavailable. */
export class ProfileNotFoundError extends Error {
    readonly code = 'profile_not_found';

    constructor(readonly profile: string) { super(`Profile does not exist: ${profile}`); this.name = 'ProfileNotFoundError'; }
}

/** @brief Namespace call failure with the invoked mount path, mirrored inside the guest realm. */
export class ToolCallError extends Error {
    constructor(message: string, readonly toolName: string, readonly code = 'tool_call_failed') {
        super(message); this.name = 'ToolCallError';
    }
}

/** @brief Invalid positional arity, also catchable as ToolCallError in the guest realm. */
export class PositionalArgumentError extends ToolCallError {
    constructor(toolName: string) { super('Invalid positional argument count', toolName, 'invalid_argument_count'); this.name = 'PositionalArgumentError'; }
}

/** @brief One simplified validation issue, retaining its complete field path. */
export interface ErrorIssue { path: string; message: string }

/** @brief Serializable error structure used by the conversion layer. */
export interface ErrorData { type: string; issues: ErrorIssue[] }

/** @brief Converted schema failure with a compact JSON message and structured issues. */
export class ZodError extends Error {
    constructor(readonly issues: ErrorIssue[]) {
        const data: ErrorData = { type: 'ZodError', issues };
        super(JSON.stringify(data));
        this.name = 'ZodError';
    }
}

/** @brief Attempt known error conversions; unsupported or failed conversions return the original value. */
export function normalizeError(error: unknown): unknown {
    try {
        if (!(error instanceof z.ZodError)) return error;
        const flatten = (issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): { path: string; message: string }[] => issues.flatMap(issue => {
            const path = [...prefix, ...issue.path];
            if (issue.code === 'invalid_union') {
                const literals = issue.errors.flat();
                if (literals.length && literals.every(child => child.code === 'invalid_value' && !child.path.length)) {
                    return [{ path: path.join('.'), message: `Expected one of: ${literals.flatMap(child => child.code === 'invalid_value' ? child.values : []).join(', ')}` }];
                }
                const branches = issue.errors.map(branch => flatten(branch, path));
                return branches.sort((a, b) => a.length - b.length)[0] ?? [{ path: path.join('.'), message: issue.message }];
            }
            if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({ path: [...path, key].join('.'), message: 'Unknown or read-only field' }));
            return [{ path: path.join('.'), message: issue.message }];
        });
        return new ZodError(flatten(error.issues));
    } catch { return error; }
}
