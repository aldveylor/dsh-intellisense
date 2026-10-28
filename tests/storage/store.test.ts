import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KvUnit } from '@deepseek-ai/dsh-storage';
import { DshStore, FileStore, MemoryStore } from '../../src/storage/store.js';

for (const backend of ['memory', 'file', 'dsh'] as const) test(`${backend} enumerates only matching detached records`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'statistics-store-'));
    let reads = 0;
    const records: Record<string, unknown> = {};
    const unit = {
        loadAll: async () => { reads++; return { tables: { state: records }, global: null }; },
        putRecord: async (_table: string, key: string, value: unknown) => { records[key] = value; },
    } as unknown as KvUnit;
    const store = backend === 'memory' ? new MemoryStore() : backend === 'file' ? new FileStore(directory) : new DshStore(unit);
    try {
        assert.deepEqual(await store.loadEntries('statistics_'), []);
        await store.save('statistics_one', { count: 1 });
        await store.save('unrelated', { count: 2 });
        if (backend === 'file') await writeFile(join(directory, 'statistics_partial.json.tmp'), 'incomplete');
        const before = reads;
        const entries = await store.loadEntries<{ count: number }>('statistics_');
        assert.deepEqual(entries, [['statistics_one', { count: 1 }]]);
        if (backend === 'dsh') assert.equal(reads - before, 1);
        entries[0]![1].count = 100;
        assert.deepEqual(await store.load('statistics_one'), { count: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
});
