import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { NamespaceAdapter } from '../../src/protocol/namespace_adapter.js';
import type { AuditEvents } from '../../src/protocol/events.js';

const marker = '<|INTELLISENSE|>';

/** @brief Script native provider output including a real structured tool call. */
async function* response(parts: string[], call = false, normal = true): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    for (const text of parts) yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: parts.join('') } };
    if (call) {
        yield { type: 'block-start', index: 1, blockType: 'tool-call' };
        yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('native-call'), name: 'read_file', arguments: '{}' } };
    }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: normal ? call ? 'tool-calls' : 'stop' : 'max-tokens' } };
}

/** @brief Capture native namespace discovery without a runtime or external provider. */
function fixture(segments: (() => AsyncIterable<StreamChunk>)[]) {
    const requests: GenerateOptions[] = [];
    const audit: { type: keyof AuditEvents; event: AuditEvents[keyof AuditEvents] }[] = [];
    const updates: string[] = [];
    const adapter = new NamespaceAdapter({ stream: request => { requests.push(request); return segments[requests.length - 1]!(); } }, {
        complete: async () => ({ kind: 'signature', text: 'function cwd(): string;' }),
        audit: (type, event) => { audit.push({ type, event }); },
        promptUpdated: text => { updates.push(text); },
    }, { turn: 1, step: 1 });
    return { requests, audit, updates, run: async () => {
        const result: StreamChunk[] = [];
        for await (const chunk of adapter.stream({ provider: 'fake', model: 'native', messages: [] })) result.push(chunk);
        return result;
    } };
}

test('native namespace completion works across every marker split and retains native tools', async () => {
    for (let split = 0; split <= marker.length; split++) {
        const f = fixture([() => response(['std.cwd', marker.slice(0, split), marker.slice(split)]), () => response(['Reading'], true)]);
        const result = await f.run();
        assert.equal(f.requests.length, 2);
        assert.equal(f.updates.length, 1);
        assert(f.requests[1]!.messages.some(message => message.role === 'system' && JSON.stringify(message).includes('function cwd')));
        assert(result.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'));
        assert(!JSON.stringify(result).includes(marker));
        assert.deepEqual(result.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } });
        assert.deepEqual(result.at(-2), { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } });
    }
});

test('BREAK vetoes native calls and raw DSML blocks including split audit comments', async () => {
    for (const dsml of ['<｜｜DSML｜｜function_calls>call</｜｜DSML｜｜function_calls>', '<||DSML||function_calls>call</||DSML||function_calls>']) {
        const f = fixture([() => response(['Cancelled.', dsml, '<|BRE', 'AK|do not execute|>'], true)]);
        const result = await f.run();
        assert(!result.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'));
        assert(!JSON.stringify(result).includes('DSML'));
        assert(!JSON.stringify(result).includes('do not execute'));
        assert.deepEqual(result.at(-1), { type: 'finish', reason: { kind: 'stop' } });
        assert(f.audit.some(record => record.type === 'exec/rewrite' && 'reason' in record.event && record.event.reason === 'abandoned'));
    }
});

test('abnormal native output never dispatches tools', async () => {
    const f = fixture([() => response(['Reading'], true, false)]);
    const result = await f.run();
    assert(!result.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call'));
    assert.equal(result.at(-1)?.type, 'finish');
    assert(JSON.stringify(result.at(-1)).includes('error'));
});
