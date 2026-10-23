import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompletionHistory, CompletionSettings, defaultHistoryLimits } from '../../src/protocol/history.js';
import { MemoryStore } from '../../src/storage/store.js';
import { runConversation } from '../../src/protocol/controller.js';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';

test('namespace and command quotas evict independently in chronological order and support live reductions', () => {
    const history = new CompletionHistory();
    for (let index = 0; index < 8; index++) history.push({ candidates: [], signatures: index % 2 ? ['signature'] : [], context: `${index % 2 ? 'command' : 'namespace'}-${index}` }, defaultHistoryLimits);
    assert.equal(history.context(defaultHistoryLimits), 'namespace-2\n\nnamespace-4\n\nnamespace-6\n\ncommand-7');
    assert.equal(history.context({ namespace: 1, command: 0 }), 'namespace-6');
    history.clear();
    assert.equal(history.context(defaultHistoryLimits), '');
});

test('history preferences are durable and invalid or failed saves preserve the last active values', async () => {
    const store = new MemoryStore();
    const settings = new CompletionSettings(store);
    await settings.load();
    assert.deepEqual(settings.limits(), { namespace: 3, command: 1 });
    await settings.configure({ namespace: 5, command: 2 });
    const restored = new CompletionSettings(store); await restored.load();
    assert.deepEqual(restored.limits(), { namespace: 5, command: 2 });
    await assert.rejects(settings.configure({ namespace: -1, command: 1 }));
    await assert.rejects(settings.configure({ namespace: 2, command: 1.5 }));
    store.save = async () => { throw new Error('Disk failure'); };
    await assert.rejects(settings.configure({ namespace: 1, command: 0 }), /Disk failure/);
    assert.deepEqual(settings.limits(), { namespace: 5, command: 2 });
});

test('continuation requests contain only three namespace results and the latest command result', async () => {
    const requests: GenerateOptions[] = [];
    const segments = ['one.', 'read(', '{}); two.', 'read(', '{}); three.', 'read(', '{}); four.', 'read(', '0)'];
    const initial: GenerateOptions = { provider: 'upstream', model: 'chosen', messages: [] };
    let completion = 0;
    await runConversation({
        generate: options => {
            requests.push(options);
            const index = requests.length - 1;
            return (async function* (): AsyncIterable<StreamChunk> {
                yield { type: 'text-delta', index: 0, text: segments[index]! + (index < 8 ? '<|INTELLISENSE|>' : '') };
                yield { type: 'finish', reason: { kind: 'stop' } };
            })();
        },
        complete: async () => {
            const index = completion++;
            return { candidates: [], signatures: index % 2 ? ['signature'] : [], context: `RESULT_${index}_END` };
        },
        execute: async () => ({ output: 'done', declarations: [] }),
        journal: async () => {},
    }, initial, 'independent-history');
    const context = JSON.stringify(requests.at(-1)!.messages);
    for (const index of [2, 4, 6, 7]) assert(context.includes(`RESULT_${index}_END`));
    for (const index of [0, 1, 3, 5]) assert(!context.includes(`RESULT_${index}_END`));
});
