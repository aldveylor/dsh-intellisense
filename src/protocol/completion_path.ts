/** @brief Extract the terminal discovery path while retaining its member-query dot. */
export function completionPath(prefix: string): string {
    return /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?)\s*(?:\([^()]*)?$/.exec(prefix)?.[1] ?? '';
}
