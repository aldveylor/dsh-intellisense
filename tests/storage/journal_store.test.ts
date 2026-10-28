import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JournalStore } from '../../src/storage/journal_store.js';
import { MemoryStore } from '../../src/storage/store.js';

for (const failure of ['journal', 'first', 'second', 'global', 'cleanup'] as const) test(`storage journal recovers idempotently after failure at ${failure}`, async () => {
    const store = new MemoryStore();
    const journal = new JournalStore(store, 'counts');
    await journal.commit([['counts_first', { total: 1 }], ['counts', { total: 1 }]]);
    const save = store.save.bind(store);
    const remove = store.remove.bind(store);
    const failedKey = failure === 'journal' ? 'counts_journal' : failure === 'global' ? 'counts' : `counts_${failure}`;
    store.save = async (key, value) => { if (key === failedKey) throw new Error('simulated crash'); await save(key, value); };
    store.remove = async key => { if (failure === 'cleanup') throw new Error('simulated crash'); await remove(key); };
    await assert.rejects(journal.commit([['counts_first', { total: 2 }], ['counts_second', { total: 1 }], ['counts', { total: 3 }]]), /simulated crash/);
    store.save = save;
    store.remove = remove;
    const restored = new JournalStore(store, 'counts');
    const entries = new Map(await restored.loadEntries<{ total: number }>());
    assert.equal(entries.get('counts')?.total, failure === 'journal' ? 1 : 3);
    assert.equal(entries.get('counts_first')?.total, failure === 'journal' ? 1 : 2);
    assert.equal(await store.load('counts_journal'), undefined);
    assert.deepEqual(new Map(await restored.loadEntries()), entries);
    // The original writer can retry its retained transaction without adding the counts again.
    await journal.flush();
    const retried = new Map(await restored.loadEntries<{ total: number }>());
    assert.equal(retried.get('counts')?.total, 3);
    assert.equal(retried.get('counts_first')?.total, 2);
    assert.equal(retried.get('counts_second')?.total, 1);
});

test('journal commits detach inputs and reject writes outside their bound scope', async () => {
    const store = new MemoryStore();
    const journal = new JournalStore(store, 'counts');
    const value = { total: 1 };
    const work = journal.commit([['counts_first', value]]);
    value.total = 9;
    await work;
    assert.deepEqual(await store.load('counts_first'), { total: 1 });
    assert.throws(() => journal.commit([['other', 1]]), /target/);
    assert.throws(() => journal.commit([['counts_journal', 1]]), /target/);
    assert.throws(() => journal.commit([['counts_first', 1], ['counts_first', 2]]), /target/);
    await store.save('counts_otherprefix', 1);
    await store.save('countssimilar', 2);
    assert(!(await journal.loadEntries()).some(([key]) => key === 'countssimilar'));
    await journal.commit([]);
    assert.equal(await store.load('counts_journal'), undefined);
});

test('a later commit drains a failed transaction before publishing its newer values', async () => {
    const store = new MemoryStore();
    const journal = new JournalStore(store, 'counts');
    const save = store.save.bind(store);
    let fail = true;
    store.save = async (key, value) => { if (key === 'counts' && fail) throw new Error('offline'); await save(key, value); };
    await assert.rejects(journal.commit([['counts', { total: 1 }]]), /offline/);
    fail = false;
    await journal.commit([['counts', { total: 2 }]]);
    assert.deepEqual(await store.load('counts'), { total: 2 });
    assert.equal(await store.load('counts_journal'), undefined);
});

test('recovery validates journal ownership before applying any record', async () => {
    const store = new MemoryStore();
    await store.save('counts_journal', { version: 1, writes: [['counts_first', 1], ['unrelated', 2]] });
    await assert.rejects(new JournalStore(store, 'counts').loadEntries(), /target/);
    assert.equal(await store.load('counts_first'), undefined);
    assert.equal(await store.load('unrelated'), undefined);
});
