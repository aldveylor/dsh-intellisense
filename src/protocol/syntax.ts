/** @brief One parsed fenced program; offsets reference unmodified model output. */
export interface ExecBlock { start: number; end: number; code: string; closed: boolean }

/** @brief Extract complete or unfinished js:exec and ts:exec programs without interpreting their contents. */
export function execBlocks(text: string): ExecBlock[] {
    const opening = /^```(?:js|ts):exec[ \t]*(?:\r?\n|$)/gm;
    const closing = /^```[ \t]*(?:\r?$)/gm;
    const blocks: ExecBlock[] = [];
    let match: RegExpExecArray | null;
    while ((match = opening.exec(text))) {
        const start = opening.lastIndex;
        closing.lastIndex = start;
        const close = closing.exec(text);
        const end = close ? closing.lastIndex : text.length;
        blocks.push({ start: match.index, end, code: text.slice(start, close?.index ?? end).replace(/\r?\n$/, ''), closed: !!close });
        if (!close) break;
        opening.lastIndex = end;
    }
    return blocks;
}

/** @brief Escape untrusted data so it cannot close wrappers, emit markers or introduce fences. */
export function escapeData(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;').replace(/"/g, '&quot;');
}

/** @brief Locate leaked native tool syntax before any executable source or discarded tail. */
export function nativeCallStart(text: string): number | undefined {
    const match = /^[ \t]*<(?:｜｜DSML｜｜|\|\|DSML\|\|)/m.exec(text);
    const block = execBlocks(text)[0];
    return match && (!block || match.index < block.start) ? match.index : undefined;
}

/** @brief Retain executable/native call syntax and partial opening markers across chunks. */
export function proseEnd(text: string): number {
    const block = execBlocks(text)[0];
    const native = nativeCallStart(text);
    if (native !== undefined) return native;
    if (block) return block.start;
    const start = text.lastIndexOf('\n') + 1;
    const line = text.slice(start);
    if (['```js:exec', '```ts:exec'].some(fence => fence.startsWith(line) || line.trimEnd() === fence)
        || ['<｜｜DSML｜｜', '<||DSML||'].some(marker => marker.startsWith(line.trimStart()))) return start;
    return text.length;
}

