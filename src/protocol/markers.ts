/** @brief Protocol tokens never enter the TypeScript compiler or VM. */
export const markers = { sense: '<|INTELLISENSE|>', line: '<|LINE_BREAK|>', stop: '<|BREAK|>' } as const;
/** @brief A completed model response, classified only after generation settles. */
export interface Segment { kind: 'code' | 'intellisense' | 'line' | 'break'; source: string }

/** @brief Parse a voluntarily completed response without interrupting model streaming. */
export function processMarkers(response: string): Segment {
    const text = response.replace(/^\s*```(?:ts|typescript)?\s*\n/, '').replace(/\n```\s*$/, '');
    const matches = [...text.matchAll(/<\|[^|]+\|>/g)];
    if (!matches.length) return { kind: 'code', source: text };
    if (matches.length !== 1) throw new Error('Emit exactly one terminal control marker');
    const match = matches[0]!;
    if (text.slice(match.index! + match[0].length).trim()) throw new Error('The model must stop immediately after a control marker');
    const kind = match[0] === markers.sense ? 'intellisense' : match[0] === markers.line ? 'line' : match[0] === markers.stop ? 'break' : undefined;
    if (!kind) throw new Error(`Unknown control marker: ${match[0]}`);
    return { kind, source: text.slice(0, match.index) };
}

/** @brief Remove an explicitly repeated full/line prefix while retaining exact cursor text. */
export function mergeContinuation(prefix: string, continuation: string): string {
    if (prefix && continuation.startsWith(prefix)) return continuation;
    const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
    if (line.length >= 3 && continuation.startsWith(line)) return prefix + continuation.slice(line.length);
    return prefix + continuation;
}
