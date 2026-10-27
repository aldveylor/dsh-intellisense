import type MiniSearch from 'minisearch';
import type { ManifestEntry } from '../namespace/namespace.js';
import { normalizeInspectQueries } from '../namespace/namespace.js';
import { SearchEngineRegistry, type SearchEngine, type SearchField, type SearchSelector } from './engine_registry.js';

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
    let cached: { key: string; index: MiniSearch } | undefined;
    if (ranked) registry.register({
        name: 'bm25', description: 'BM25 ranked fuzzy and prefix search.',
        search: ({ documents, keywords, fields }) => {
            const key = JSON.stringify([fields, documents]);
            if (cached?.key !== key) {
                const index = new ranked({ fields: [...fields], tokenize, searchOptions: { combineWith: 'OR', fuzzy: .2, prefix: true, boost: { name: 2 } } });
                index.addAll([...documents]);
                cached = { key, index };
            }
            return cached.index.search(keywords.join(' ')).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
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

/** @brief Search the effective tree through its selected engine and return bounded, unique command paths. */
export async function searchEntries(entries: readonly ManifestEntry[], options: SearchOptions, selector: SearchSelector): Promise<string[]> {
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
    const documents = entries.filter(entry => !namespace || entry.path.startsWith(namespace + '.')).map(entry => ({
        id: entry.path, name: fields.includes('name') ? entry.path : '', description: fields.includes('description') ? entry.doc : '',
        parameters: fields.includes('parameters') ? JSON.stringify(entry.schema) : '',
    }));
    if (!documents.length) return [];
    const allowed = new Set(documents.map(document => document.id));
    return [...new Set(await engine.search({ documents, keywords, fields, maxResults: limit }))].filter(path => allowed.has(path)).slice(0, limit);
}
