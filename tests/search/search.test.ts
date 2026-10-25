import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchEngines, searchEntries, searchParameters } from '../../src/search/search.js';
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
