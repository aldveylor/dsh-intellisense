import type { TokenUsage } from '@deepseek-ai/dsh-llm';

/** @brief Abort even a stalled iterator/query while propagating the same signal to its owner. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([promise, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
}

/** @brief Merge disjoint usage fields, retaining totalTokens only when every segment supplied it. */
export function addUsage(total: TokenUsage | undefined, part: TokenUsage | undefined): TokenUsage | undefined {
    if (!part) return total;
    if (!total) return { ...part };
    const merged: TokenUsage = { inputTokens: total.inputTokens + part.inputTokens, outputTokens: total.outputTokens + part.outputTokens };
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
        if (total[key] !== undefined || part[key] !== undefined) merged[key] = (total[key] ?? 0) + (part[key] ?? 0);
    }
    if (total.totalTokens !== undefined && part.totalTokens !== undefined) merged.totalTokens = total.totalTokens + part.totalTokens;
    return merged;
}

