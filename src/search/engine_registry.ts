/** @brief Searchable command fields exposed by the target selector. */
export type SearchField = 'name' | 'description' | 'parameters' | 'returns';

/** @brief One effective command projected onto searchable namespace fields. */
export interface SearchDocument extends Record<SearchField, string> { id: string }

/** @brief Validated selection passed directly to builtin and custom search engines. */
export interface SearchSelection { documents: readonly SearchDocument[]; keywords: readonly string[]; fields: readonly SearchField[]; maxResults: number }

/** @brief Pluggable command ranking or matching implementation. */
export interface SearchEngine {
    name: string;
    description: string;
    /** @brief Return matching document IDs in result order; asynchronous engines are supported. */
    search(selection: SearchSelection): readonly string[] | Promise<readonly string[]>;
}

/** @brief Registry snapshot shared by schema selectors and execution dispatch. */
export interface SearchSelector { engines: readonly SearchEngine[]; defaultMethod: string }

/** @brief Own search engines, their selectable default, and contract change subscriptions. */
export class SearchEngineRegistry {
    private engines = new Map<string, SearchEngine>();
    private listeners = new Set<() => void>();
    private defaultMethod?: string;

    constructor(defaultMethod?: string) { this.defaultMethod = defaultMethod; }

    /** @brief Register one unique method and return an ownership-scoped removal callback. */
    register(engine: SearchEngine): () => void {
        if (!/^[a-z][a-z0-9_]*$/.test(engine.name) || this.engines.has(engine.name)) throw new Error(`Invalid or duplicate search method: ${engine.name}`);
        this.engines.set(engine.name, engine);
        this.notify();
        return () => {
            if (this.engines.get(engine.name) !== engine) return;
            this.engines.delete(engine.name);
            this.notify();
        };
    }

    /** @brief Select a default method; names may be configured before their plugin registers. */
    setDefault(method: string): void {
        if (!/^[a-z][a-z0-9_]*$/.test(method)) throw new Error('Invalid default search method');
        this.defaultMethod = method;
        this.notify();
    }

    /** @brief Resolve live choices and use the first available method while a configured default is absent. */
    selector(): SearchSelector {
        const engines = [...this.engines.values()];
        return { engines, defaultMethod: this.defaultMethod && this.engines.has(this.defaultMethod) ? this.defaultMethod : engines[0]?.name ?? '' };
    }

    /** @brief Refresh registered tool contracts when engines or the default change. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** @brief Publish selector changes to the owning presentation scopes. */
    private notify(): void { for (const listener of this.listeners) listener(); }
}
