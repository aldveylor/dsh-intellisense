import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import { toolName, validatePath } from './path.js';
export { validatePath } from './path.js';
import type { Store } from '../storage/store.js';

/** @brief Stable physical identity and the enforced native JSON contracts. */
export interface PhysicalTool {
    id: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
}

/** @brief Semantic naming, exposure and stable path configuration. */
export interface Mapping {
    id: string;
    path: string;
    aliases: string[];
    description?: string;
    enabled: boolean;
    pinned: boolean;
    alwaysVisible?: boolean;
}

/** @brief Persisted namespace documentation and unconditional prompt visibility. */
export interface Namespace { path: string; alwaysVisible: boolean; description: string }

/** @brief Successful physical invocations, independent of completion exposure. */
export interface Usage { calls: number; lastUsed: number; exposures: number }
/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryState { version: 1; revision: number; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; usage: Record<string, Usage> }
/** @brief Structured maintenance proposal; execution policy remains owned by DSH. */
export interface Proposal { revision: number; changes: Array<{ id: string; path: string; aliases?: string[]; description?: string }> }

/** @brief Transactional semantic registry; unconfigured identities remain under unknown. */
export class SemanticRegistry {
    private physical = new Map<string, PhysicalTool>();
    private state: RegistryState = { version: 1, revision: 0, mappings: [], usage: {} };
    private writeChain: Promise<unknown> = Promise.resolve();

    constructor(private store: Store) {}

    async load(): Promise<void> {
        const saved = await this.store.load<RegistryState>('registry');
        if (saved) {
            if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.mappings) || !saved.usage) throw new Error('Invalid registry snapshot');
            this.validateMappings(saved.mappings);
            this.validateNamespaces(saved.namespaces ?? [], saved.mappings);
            this.state = saved;
        }
    }

    refresh(tools: PhysicalTool[]): void {
        if (new Set(tools.map(t => t.id)).size !== tools.length) throw new Error('Duplicate physical tool identity');
        const next = new Map(tools.map(t => [t.id, structuredClone(t)]));
        // Identifier escaping preserves physical names without merging distinct identities.
        this.physical = next;
    }

    snapshot(): RegistryState { return structuredClone(this.state); }

    tools(): PhysicalTool[] { return structuredClone([...this.physical.values()]); }

    effective(): Array<Mapping & { tool: PhysicalTool }> {
        return [...this.physical.values()].map(tool => ({
            id: tool.id,
            path: `unknown.${toolName(tool.id)}`,
            aliases: [], enabled: true, pinned: false,
            ...this.state.mappings.find(m => m.id === tool.id), tool,
        }));
    }

    private validateMappings(mappings: Mapping[]): void {
        const ids = new Set<string>();
        const paths: string[] = [];
        for (const m of mappings) {
            if (!m || typeof m.id !== 'string' || ids.has(m.id) || !Array.isArray(m.aliases) || m.aliases.some(a => typeof a !== 'string') || typeof m.enabled !== 'boolean' || typeof m.pinned !== 'boolean' || (m.description !== undefined && typeof m.description !== 'string') || (m.alwaysVisible !== undefined && typeof m.alwaysVisible !== 'boolean')) throw new Error('Invalid mapping');
            ids.add(m.id);
            for (const path of [m.path, ...m.aliases]) {
                validatePath(path);
                if (path === 'unknown' || path.startsWith('unknown.')) throw new Error('unknown is reserved for unconfigured tools');
                if (paths.some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`))) throw new Error(`Namespace collision: ${path}`);
                paths.push(path);
            }
        }
    }

    /** @brief Validate namespace metadata against callable paths and reserved names. */
    private validateNamespaces(namespaces: Namespace[], mappings: Mapping[]): void {
        if (!Array.isArray(namespaces)) throw new Error('Invalid namespaces');
        const seen = new Set<string>();
        for (const entry of namespaces) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.alwaysVisible !== 'boolean' || typeof entry.description !== 'string' || seen.has(entry.path)) throw new Error('Invalid namespace');
            validatePath(`${entry.path}.namespace_check`);
            if (entry.path.split('.')[0] === 'unknown') throw new Error('unknown is reserved for unconfigured tools');
            if (mappings.flatMap(m => [m.path, ...m.aliases]).some(path => entry.path === path || entry.path.startsWith(`${path}.`))) throw new Error(`Namespace collision: ${entry.path}`);
            seen.add(entry.path);
        }
    }

    private transaction(operation: () => Promise<void>): Promise<void> {
        const result = this.writeChain.then(operation);
        this.writeChain = result.catch(() => {});
        return result;
    }

    async configure(mappings: Mapping[], revision: number, namespaces?: Namespace[], order?: string[]): Promise<void> {
        const detached = structuredClone(mappings);
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            this.validateMappings(detached);
            const metadata = structuredClone(namespaces ?? this.state.namespaces ?? []);
            this.validateNamespaces(metadata, detached);
            for (const m of detached) {
                if (!this.physical.has(m.id) && !this.state.mappings.some(old => old.id === m.id)) throw new Error(`Unknown physical identity: ${m.id}`);
                const old = this.state.mappings.find(o => o.id === m.id);
                if (old?.pinned && (old.path !== m.path || JSON.stringify(old.aliases) !== JSON.stringify(m.aliases))) throw new Error(`Pinned mapping: ${m.id}`);
            }
            for (const old of this.state.mappings) {
                if (old.pinned && !detached.some(m => m.id === old.id)) throw new Error(`Pinned mapping: ${old.id}`);
            }
            const requestedOrder = order ?? this.state.order ?? [];
            if (!Array.isArray(requestedOrder) || requestedOrder.some(path => typeof path !== 'string')) throw new Error('Invalid tree order');
            const known = new Set([...metadata.map(n => n.path), ...detached.flatMap(m => [m.path, ...m.aliases])]
                .flatMap(path => path.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'))));
            const treeOrder = [...new Set([...requestedOrder, ...known])].filter(path => known.has(path));
            const next = { ...this.state, revision: this.state.revision + 1, mappings: detached, namespaces: metadata, order: treeOrder };
            await this.store.save('registry', next);
            this.state = next;
        });
    }

    async applyProposal(proposal: Proposal): Promise<void> {
        if (!proposal || !Number.isInteger(proposal.revision) || !Array.isArray(proposal.changes)) throw new Error('Invalid organization proposal');
        const current = this.snapshot();
        const mappings = new Map(current.mappings.map(m => [m.id, m]));
        const seen = new Set<string>();
        for (const change of proposal.changes) {
            if (!change || seen.has(change.id) || !this.physical.has(change.id) || Object.keys(change).some(k => !['id', 'path', 'aliases', 'description'].includes(k))) throw new Error('Invalid proposal identity or fields');
            seen.add(change.id);
            const old = mappings.get(change.id);
            if (old && (old.pinned || old.path !== change.path)) throw new Error(`Stable mapping cannot move: ${change.id}`);
            if (old && change.aliases && old.aliases.some(alias => !change.aliases!.includes(alias))) throw new Error(`Stable alias cannot be removed: ${change.id}`);
            mappings.set(change.id, { enabled: true, pinned: false, aliases: [], ...old, ...change });
        }
        await this.configure([...mappings.values()], proposal.revision);
    }

    declarations(allowed?: Set<string>): string {
        const tree: Record<string, unknown> = Object.create(null);
        const rootFunctions: string[] = [];
        for (const mapping of this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)))) {
            const doc = mapping.tool.description.replaceAll('*/', '* /');
            const signature = `(args: ${jsonSchemaToTs(mapping.tool.parameters)}) => Promise<${jsonSchemaToTs(mapping.tool.output)}>`;
            for (const path of [mapping.path, ...mapping.aliases]) {
                const parts = path.split('.');
                if (parts.length === 1) { rootFunctions.push(`/** ${doc} */\ndeclare const ${path}: ${signature};`); continue; }
                let node = tree;
                for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
                node[parts.at(-1)!] = `/** ${doc} */\n${JSON.stringify(parts.at(-1)!)}: ${signature};`;
            }
        }
        const doc = (path: string): string => {
            const description = this.state.namespaces?.find(n => n.path === path)?.description;
            return description ? `/** ${description.replaceAll('*/', '* /')} */\n` : '';
        };
        const render = (node: Record<string, unknown>, path: string): string => `{\n${Object.entries(node).map(([k, v]) => typeof v === 'string' ? v : `${doc(`${path}.${k}`)}${JSON.stringify(k)}: ${render(v as Record<string, unknown>, `${path}.${k}`)};`).join('\n')} }`;
        return [...rootFunctions, ...Object.entries(tree).map(([key, value]) => `${doc(key)}declare const ${key}: ${render(value as Record<string, unknown>, key)};`)].join('\n');
    }

    /** @brief Include configured namespace hints only when an agent can access a descendant. */
    namespaceVisibility(allowed?: Set<string>): string[] {
        const visible = this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)));
        const paths = visible.flatMap(m => [m.path, ...m.aliases]);
        return [
            ...(this.state.namespaces ?? []).filter(n => n.alwaysVisible && paths.some(path => path.startsWith(`${n.path}.`)))
                .map(n => `${n.path}${n.description ? ` — ${n.description}` : ''}`),
            ...visible.filter(m => m.alwaysVisible).flatMap(m => [m.path, ...m.aliases]
                .map(path => `${path}(args: ${jsonSchemaToTs(m.tool.parameters)}) => Promise<${jsonSchemaToTs(m.tool.output)}>\n${m.description ?? m.tool.description}`)),
        ];
    }

    roots(): string[] { return [...new Set(this.effective().filter(m => m.enabled).flatMap(m => [m.path, ...m.aliases].map(p => p.split('.')[0]!)))].sort(); }

    /** @brief Reuse durable successful-call statistics for visible namespace discovery. */
    namespaceHints(allowed?: Set<string>, limit = 8): { frequent: string[]; recent: string[] } {
        const used = this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)) && (this.state.usage[m.id]?.calls ?? 0) > 0);
        const calls = (id: string): Usage => this.state.usage[id]!;
        const paths = (mappings: Mapping[]): string[] => [...new Set(mappings.flatMap(m => [m.path, ...m.aliases]))].slice(0, limit);
        return {
            frequent: paths([...used].sort((a, b) => calls(b.id).calls - calls(a.id).calls || calls(b.id).lastUsed - calls(a.id).lastUsed || a.path.localeCompare(b.path))),
            recent: paths([...used].sort((a, b) => calls(b.id).lastUsed - calls(a.id).lastUsed || a.path.localeCompare(b.path))),
        };
    }

    async invoke(path: string, args: unknown, dispatch: (id: string, args: unknown) => Promise<unknown>): Promise<unknown> {
        const mapping = this.effective().find(m => m.path === path || m.aliases.includes(path));
        if (!mapping?.enabled) throw new Error(`Execution denied: ${path}`);
        const errors = validateJsonSchemaValue(mapping.tool.parameters as JsonSchemaNode, args);
        if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
        const value = await dispatch(mapping.id, args);
        await this.transaction(async () => {
            const next = this.snapshot();
            const usage = (Object.hasOwn(next.usage, mapping.id) ? next.usage[mapping.id] : undefined) ?? { calls: 0, lastUsed: 0, exposures: 0 };
            Object.defineProperty(next.usage, mapping.id, { value: { ...usage, calls: usage.calls + 1, lastUsed: Date.now() }, enumerable: true, configurable: true, writable: true });
            await this.store.save('registry', next);
            this.state = next;
        });
        return value;
    }

    async expose(paths: string[]): Promise<void> {
        await this.transaction(async () => {
            const next = this.snapshot();
            for (const id of new Set(this.effective().filter(m => paths.includes(m.path) || m.aliases.some(a => paths.includes(a))).map(m => m.id))) {
                const usage = (Object.hasOwn(next.usage, id) ? next.usage[id] : undefined) ?? { calls: 0, lastUsed: 0, exposures: 0 };
                Object.defineProperty(next.usage, id, { value: { ...usage, exposures: usage.exposures + 1 }, enumerable: true, configurable: true, writable: true });
            }
            await this.store.save('registry', next);
            this.state = next;
        });
    }
}
