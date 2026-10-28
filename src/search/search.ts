import type MiniSearch from 'minisearch';
import type { ManifestEntry } from '../namespace/namespace.js';
import { normalizeInspectQueries } from '../namespace/namespace.js';
import { SearchEngineRegistry, type SearchDocument, type SearchEngine, type SearchField, type SearchSelector } from './engine_registry.js';

/** @brief Load optional BM25 support; missing installations retain substring matching. */
const miniSearch: typeof MiniSearch | undefined = await import('minisearch').then(module => module.default).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
});

/** @brief Search controls derived from the method and target selectors. */
export interface SearchOptions {
    keywords: string[];
    method?: string;
    max_results?: number;
    target?: SearchField | 'all';
    namespace_path?: string;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const stableDocuments = new WeakSet<readonly SearchDocument[]>();

/** @brief Split identifiers, natural language and Chinese words into searchable terms. */
function tokenize(text: string): string[] {
    const words = text.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_.$]/g, ' ');
    return [...segmenter.segment(words)].filter(part => part.isWordLike).map(part => part.segment.toLowerCase());
}

/** @brief Match any keyword as a case-insensitive substring in the selected fields. */
export const accurateEngine: SearchEngine = {
    name: 'accurate', description: 'Case-insensitive substring matching.',
    search: ({ documents, keywords, fields }) => documents.filter(document => fields.some(field => keywords.some(word => document[field].toLowerCase().includes(word))))
        .map(document => document.id).sort(),
};

/** @brief Build an independent registry with optional BM25 and always-available substring matching. */
export function createSearchEngines(defaultMethod?: string, ranked = miniSearch): SearchEngineRegistry {
    const registry = new SearchEngineRegistry(defaultMethod);
    const cache: Array<{ fields: readonly SearchField[]; documents: readonly SearchDocument[]; index: MiniSearch; size: number }> = [];
    let cachedChars = 0;
    const maxCachedChars = 2_000_000;
    if (ranked) registry.register({
        name: 'bm25', description: 'BM25 ranked fuzzy and prefix search.',
        search: ({ documents, keywords, fields }) => {
            const hit = cache.findIndex(candidate => candidate.fields.length === fields.length
                && candidate.fields.every((field, index) => field === fields[index])
                && (candidate.documents === documents || (!stableDocuments.has(documents) && candidate.documents.length === documents.length
                && candidate.documents.every((document, index) => {
                    const next = documents[index]!;
                    return document.id === next.id && fields.every(field => document[field] === next[field]);
                }))));
            let index: MiniSearch;
            if (hit >= 0) {
                const [cached] = cache.splice(hit, 1);
                cache.push(cached!);
                index = cached!.index;
            } else {
                index = new ranked({ fields: [...fields], tokenize, searchOptions: { combineWith: 'OR', fuzzy: .2, prefix: true, boost: { name: 2 } } });
                index.addAll([...documents]);
                const size = documents.reduce((sum, document) => sum + document.id.length + fields.reduce((sum, field) => sum + document[field].length, 0), 0);
                if (size <= maxCachedChars) {
                    while (cache.length && (cache.length >= 8 || cachedChars + size > maxCachedChars)) cachedChars -= cache.shift()!.size;
                    cache.push({ fields: [...fields], documents: stableDocuments.has(documents) ? documents : documents.map(document => ({ ...document })), index, size });
                    cachedChars += size;
                }
            }
            return index.search(keywords.join(' ')).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
                .map(result => String(result.id));
        },
    });
    registry.register(accurateEngine);
    return registry;
}

/** @brief Define target selector choices once for both parameters and field selection. */
const targets: Record<SearchField | 'all', readonly SearchField[]> = {
    name: ['name'], description: ['description'], parameters: ['parameters'], all: ['name', 'description', 'parameters'],
};

/** @brief Generate tool parameters directly from the current registry and target selector structure. */
export function searchParameters(selector: SearchSelector) {
    return {
        keywords: { type: 'array', items: { type: 'string' }, required: true, description: 'Keywords combined with OR; matching any keyword is sufficient.' },
        ...(selector.engines.length > 1 ? { method: { type: 'string' as const, enum: selector.engines.map(engine => engine.name), default: selector.defaultMethod,
            description: selector.engines.map(engine => `${engine.name}: ${engine.description}`).join(' ') } } : {}),
        max_results: { type: 'integer', default: 10, description: 'Maximum number of command paths to return.' },
        target: { type: 'string', enum: Object.keys(targets) as (SearchField | 'all')[], default: 'all', description: 'Command fields to search.' },
        namespace_path: { type: 'string', default: '', description: 'Namespace subtree to search; an empty string searches the entire tree.' },
    } as const;
}

/** @brief Project one selected subtree without serializing unselected fields. */
function projectDocuments(entries: readonly ManifestEntry[], namespace: string, fields: readonly SearchField[]): SearchDocument[] {
    return entries.filter(entry => !namespace || entry.path.startsWith(namespace + '.')).map(entry => ({
        id: entry.path, name: fields.includes('name') ? entry.path : '', description: fields.includes('description') ? entry.doc : '',
        parameters: fields.includes('parameters') ? JSON.stringify(entry.schema) : '',
    }));
}

/** @brief One projected corpus and its valid result identities. */
interface SearchDocuments { documents: readonly SearchDocument[]; allowed: ReadonlySet<string> }

/** @brief Cache bounded immutable document projections for one scoped manifest generation. */
export class SearchCorpus {
    private cache = new Map<string, SearchDocuments & { size: number }>();
    private cachedChars = 0;

    constructor(private entries: readonly ManifestEntry[]) {}

    /** @brief Reuse document serialization and membership validation across keyword changes. */
    search(options: SearchOptions, selector: SearchSelector): Promise<string[]> { return runSearch(this.entries, options, selector, this); }

    /** @brief Keep at most eight subtree/field projections within a two-million-character input budget. */
    documentsFor(namespace: string, fields: readonly SearchField[]): SearchDocuments {
        const key = JSON.stringify([namespace, fields]);
        const cached = this.cache.get(key);
        if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
        const documents = Object.freeze(projectDocuments(this.entries, namespace, fields).map(document => Object.freeze(document)));
        const projection = { documents, allowed: new Set(documents.map(document => document.id)) };
        const size = documents.reduce((sum, document) => sum + document.id.length + fields.reduce((sum, field) => sum + document[field].length, 0), 0);
        if (size <= 2_000_000) {
            while (this.cache.size && (this.cache.size >= 8 || this.cachedChars + size > 2_000_000)) {
                const oldest = this.cache.keys().next().value!;
                this.cachedChars -= this.cache.get(oldest)!.size;
                this.cache.delete(oldest);
            }
            this.cache.set(key, { ...projection, size });
            this.cachedChars += size;
            stableDocuments.add(documents);
        }
        return projection;
    }
}

/** @brief Search mutable standalone entries without assuming their identities imply immutable content. */
export function searchEntries(entries: readonly ManifestEntry[], options: SearchOptions, selector: SearchSelector): Promise<string[]> {
    return runSearch(entries, options, selector);
}

/** @brief Search the selected corpus and return bounded, unique command paths. */
async function runSearch(entries: readonly ManifestEntry[], options: SearchOptions, selector: SearchSelector, corpus?: SearchCorpus): Promise<string[]> {
    const keywords = [...new Set(options.keywords.map(word => word.trim().toLowerCase()).filter(Boolean))];
    const limit = options.max_results ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('max_results must be a nonnegative integer');
    const namespace = normalizeInspectQueries([options.namespace_path ?? ''])[0]!.replace(/\.$/, '');
    const fields = targets[options.target ?? 'all'];
    if (!fields) throw new Error('Invalid search target');
    const method = options.method ?? selector.defaultMethod;
    const engine = selector.engines.find(engine => engine.name === method);
    if (!engine) throw new Error(`Unknown search method: ${method}`);
    if (!keywords.length || !limit) return [];
    const { documents, allowed } = corpus?.documentsFor(namespace, fields) ?? (() => {
        const documents = projectDocuments(entries, namespace, fields);
        return { documents, allowed: new Set(documents.map(document => document.id)) };
    })();
    if (!documents.length) return [];
    return [...new Set(await engine.search({ documents, keywords, fields, maxResults: limit }))].filter(path => allowed.has(path)).slice(0, limit);
}
