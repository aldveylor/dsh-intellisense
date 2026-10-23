/** @brief One parsed fenced program; offsets reference the unmodified model output. */
export interface ExecBlock { start: number; end: number; code: string; closed: boolean; abandoned: boolean }

/** @brief Parse only line-leading js:exec / ts:exec fences, ignoring nested openings until closure. */
export function execBlocks(text: string): ExecBlock[] {
    const opening = /^```(?:js|ts):exec[ \t]*(?:\r?\n|$)/gm;
    const closing = /^```[ \t]*(?:\r?$)/gm;
    const blocks: ExecBlock[] = [];
    let match: RegExpExecArray | null;
    while ((match = opening.exec(text))) {
        const start = opening.lastIndex;
        closing.lastIndex = start;
        const controls = [...text.slice(start).matchAll(/<\|(?:LINEBREAK|BREAK)(?:\|[\s\S]*?)?\|>/g)].map(token => ({ text: token[0], start: start + token.index!, end: start + token.index! + token[0].length }));
        let close = closing.exec(text);
        while (close && controls.some(control => control.start <= close!.index && close!.index < control.end)) close = closing.exec(text);
        const abandoned = controls.find(control => control.text.startsWith('<|BREAK') && (!close || control.start < close.index));
        const end = abandoned?.end ?? (close ? closing.lastIndex : text.length);
        const code = abandoned ? text.slice(start, end) : close ? text.slice(start, close.index).replace(/\r?\n$/, '') : text.slice(start);
        blocks.push({ start: match.index, end, code, closed: !!abandoned || close !== null, abandoned: !!abandoned });
        if (!close && !abandoned) break;
        opening.lastIndex = end;
    }
    return blocks;
}

/** @brief Strip compatibility control tokens, preserving only LINEBREAK's newline effect. */
export function cleanControls(text: string, marker: string): string {
    return text.split(marker).join('').replace(/<\|LINEBREAK(?:\|[\s\S]*?)?\|>/g, '\n').replace(/<\|BREAK(?:\|[\s\S]*?)?\|>/g, '');
}

/** @brief Escape untrusted data so it cannot close wrappers, emit markers or introduce fences. */
export function escapeData(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;').replace(/"/g, '&quot;');
}

/** @brief Drop a repeated full prefix or suffix line when the model continues an interrupted program. */
export function joinContinuation(prefix: string, text: string): { text: string; discarded: number } {
    if (text.startsWith(prefix)) return { text, discarded: prefix.length };
    const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
    if (line.length >= 3 && text.startsWith(line)) return { text: prefix + text.slice(line.length), discarded: line.length };
    return { text: prefix + text, discarded: 0 };
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

/** @brief Hold marker prefixes across chunks so no complete control marker reaches a consumer. */
export class MarkerBuffer {
    private tail = '';

    constructor(private marker: string) {}

    /** @brief Withhold a trailing partial marker or compatibility token until more input arrives. */
    push(text: string, final = false): string {
        const value = this.tail + text;
        let end = value.length;
        if (!final) {
            const start = value.lastIndexOf('<|');
            if (start >= 0 && !value.slice(start).includes('|>')) end = start;
            for (let size = 1; size < this.marker.length && size <= value.length; size++) {
                if (this.marker.startsWith(value.slice(-size))) end = Math.min(end, value.length - size);
            }
            if (value.endsWith('<')) end = Math.min(end, value.length - 1);
        }
        this.tail = value.slice(end);
        return cleanControls(value.slice(0, end), this.marker);
    }
}

/** @brief Remove native DSML call blocks when a namespace BREAK vetoes dispatch. */
export function stripNativeCalls(text: string): string {
    return text.replace(/<(?:｜｜DSML｜｜|\|\|DSML\|\|)function_calls\b[\s\S]*?(?:<\/(?:｜｜DSML｜｜|\|\|DSML\|\|)function_calls>|(?=<\|BREAK)|$)/g, '');
}
