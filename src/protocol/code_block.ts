/** @brief Fence arbitrary result text without allowing embedded fences to close the block. */
export function codeBlock(value: string, language: string): string {
    const length = Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1));
    const fence = '`'.repeat(length);
    return `${fence}${language}\n${value}\n${fence}`;
}
