import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchEngines, searchEntries, searchParameters, SearchCorpus } from '../../src/search/search.js';
import { SearchEngineRegistry } from '../../src/search/engine_registry.js';
import type { ManifestEntry } from '../../src/namespace/namespace.js';

const entries: ManifestEntry[] = [
    { path: 'files.read', tool: 'read', doc: 'Read a document', schema: { type: 'object', properties: { file_path: { type: 'string', description: 'Absolute filename' } } }, output: { type: 'string', description: 'Text contents' } },
    { path: 'files.write', tool: 'write', doc: 'Write a document', schema: { type: 'object', properties: { content: { type: 'string' } } }, output: { type: 'boolean', description: 'Saved successfully' } },
    { path: 'files_extra.delete', tool: 'delete', doc: 'Delete a document', schema: { type: 'object' }, output: { type: 'null' } },
    { path: 'mail.send', tool: 'send', doc: '发送邮件', schema: { type: 'object' }, output: { type: 'null' } },
];

const engines = createSearchEngines();

test('accurate search applies OR, field selectors, namespace boundaries and result limits', async () => {
    const selector = engines.selector();
    assert.deepEqual(await searchEntries(entries, { keywords: ['READ', 'write'], method: 'accurate', target: 'name' }, selector), ['files.read', 'files.write']);
    assert.deepEqual(await searchEntries(entries, { keywords: ['document'], method: 'accurate', namespace_path: 'global.files.' }, selector), ['files.read', 'files.write']);
    assert.deepEqual(await searchEntries(entries, { keywords: ['filename'], method: 'accurate', target: 'parameters' }, selector), ['files.read']);
    assert.deepEqual(searchParameters(selector).target.enum, ['name', 'description', 'parameters', 'all']);
    for (const method of selector.engines.map(engine => engine.name)) {
        assert.deepEqual(await searchEntries(entries, { keywords: ['successfully'], method, target: 'all' }, selector), []);
    }
    await assert.rejects(searchEntries(entries, { keywords: ['successfully'], target: 'returns' as never }, selector), /Invalid search target/);
    assert.deepEqual(await searchEntries(entries, { keywords: ['document'], method: 'accurate', max_results: 1 }, selector), ['files.read']);
    assert.deepEqual(await searchEntries(entries, { keywords: ['', '   '] }, selector), []);
    assert.deepEqual(await searchEntries(entries, { keywords: ['document'], max_results: 0 }, selector), []);
    await assert.rejects(searchEntries(entries, { keywords: ['document'], max_results: -1 }, selector));
});

test('BM25 supports typo neighbors, identifier tokens and Chinese words', async () => {
    const selector = engines.selector();
    assert(selector.engines.some(engine => engine.name === 'bm25'));
    assert.deepEqual(await searchEntries(entries, { keywords: ['documant'], target: 'description', namespace_path: 'files' }, selector), ['files.read', 'files.write']);
    assert.deepEqual(await searchEntries(entries, { keywords: ['filename'], target: 'parameters' }, selector), ['files.read']);
    assert.deepEqual(await searchEntries(entries, { keywords: ['邮件'], target: 'description' }, selector), ['mail.send']);
});

test('custom asynchronous engines receive selected documents and can become the default', async () => {
    const registry = new SearchEngineRegistry('custom');
    registry.register({ name: 'custom', description: 'Custom ordering', search: async selection => {
        assert.deepEqual(selection.fields, ['name']);
        assert.deepEqual(selection.keywords, ['read']);
        assert.deepEqual(selection.documents.map(document => document.id), ['files.read', 'files.write']);
        return ['mail.send', 'files.write', 'files.write', 'files.read'];
    } });
    const unsubscribe = engines.register({ name: 'custom_test', description: 'Test engine', search: () => [] });
    try {
        engines.setDefault('custom_test');
        assert.equal(searchParameters(engines.selector()).method!.default, 'custom_test');
        assert.deepEqual(await searchEntries(entries, { keywords: ['read'], target: 'name', namespace_path: 'files', max_results: 1 }, registry.selector()), ['files.write']);
    } finally { unsubscribe(); engines.setDefault('bm25'); }
});

test('selector subscriptions, duplicate registration and unloading keep defaults consistent', () => {
    const registry = new SearchEngineRegistry();
    let changes = 0;
    const unsubscribe = registry.subscribe(() => { changes++; });
    const remove = registry.register({ name: 'custom', description: 'Custom engine', search: () => [] });
    registry.setDefault('custom');
    assert.equal(registry.selector().defaultMethod, 'custom');
    assert.throws(() => registry.register({ name: 'custom', description: '', search: () => [] }), /duplicate/);
    remove(); remove();
    assert.equal(registry.selector().defaultMethod, '');
    assert.equal(changes, 3);
    unsubscribe();
});

test('BM25 reuses alternating document sets and invalidates changed documents and fields', async () => {
    const { default: MiniSearch } = await import('minisearch');
    let builds = 0;
    /** @brief Count actual index construction while retaining real BM25 behavior. */
    class CountingSearch extends MiniSearch {
        constructor(options: ConstructorParameters<typeof MiniSearch>[0]) { super(options); builds++; }
    }
    const selector = createSearchEngines(undefined, CountingSearch).selector();
    const options = { keywords: ['document'], target: 'description' as const };
    await searchEntries(entries, options, selector);
    await searchEntries(entries, { ...options, namespace_path: 'files' }, selector);
    await searchEntries(structuredClone(entries), options, selector);
    assert.equal(builds, 2);
    const changed = structuredClone(entries);
    changed[0]!.doc = 'Unique replacement phrase';
    assert.deepEqual(await searchEntries(changed, { keywords: ['Unique'], target: 'description' }, selector), ['files.read']);
    assert.equal(builds, 3);
    assert.deepEqual(await searchEntries(entries, { keywords: ['Unique'], target: 'description' }, selector), []);
    await searchEntries(entries, { keywords: ['read'], target: 'name' }, selector);
    assert.equal(builds, 4);
});

test('BM25 evicts least recently used indexes after eight distinct document sets', async () => {
    const { default: MiniSearch } = await import('minisearch');
    let builds = 0;
    /** @brief Observe cache eviction through index creation. */
    class CountingSearch extends MiniSearch {
        constructor(options: ConstructorParameters<typeof MiniSearch>[0]) { super(options); builds++; }
    }
    const selector = createSearchEngines(undefined, CountingSearch).selector();
    const search = (index: number) => searchEntries([{ ...entries[0]!, doc: `document variant ${index}` }], { keywords: ['document'] }, selector);
    for (let index = 0; index < 8; index++) await search(index);
    await search(0);
    await search(8);
    await search(0);
    assert.equal(builds, 9);
    await search(1);
    assert.equal(builds, 10);
});


test('immutable corpora reuse document serialization across keywords and invalidate by range and fields', async () => {
    let projections = 0;
    const corpus = new SearchCorpus([{ ...entries[0]!, get schema() { projections++; return entries[0]!.schema; } }]);
    const selector = createSearchEngines().selector();
    const options = { keywords: ['filename'], target: 'parameters' as const };
    assert.deepEqual(await corpus.search(options, selector), ['files.read']);
    assert.equal(projections, 1);
    assert.deepEqual(await corpus.search({ ...options, keywords: ['absolute'] }, selector), ['files.read']);
    assert.equal(projections, 1);
    await corpus.search({ ...options, namespace_path: 'files' }, selector);
    assert.equal(projections, 2);
    await corpus.search({ keywords: ['read'], target: 'name' }, selector);
    assert.equal(projections, 2);
    const first = corpus.documentsFor('', ['parameters']);
    assert.equal(first, corpus.documentsFor('', ['parameters']));
    assert(Object.isFrozen(first.documents));
    assert(Object.isFrozen(first.documents[0]));
});
