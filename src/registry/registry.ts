import { createHash } from 'node:crypto';
import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
import type { Store } from '../storage/store.js';

/** @brief Stable physical identity and the enforced native JSON contracts. */
export interface PhysicalTool {
    id: string;
    description: string;
    parameters: Record<string, unknown>;
    output: unknown;
}

/** @brief Semantic naming and independent execution authorization. */
export interface Mapping {
    id: string;
    path: string;
    aliases: string[];
    description?: string;
    enabled: boolean;
    authorized: boolean;
    pinned: boolean;
}

/** @brief Successful physical invocations, independent of completion exposure. */
export interface Usage { calls: number; lastUsed: number; exposures: number }
/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryState { version: 1; revision: number; mappings: Mapping[]; usage: Record<string, Usage> }
/** @brief Structured maintenance proposal; grants cannot be authored by the model. */
export interface Proposal { revision: number; changes: Array<{ id: string; path: string; aliases?: string[]; description?: string }> }

const forbidden = new Set(['__proto__', 'prototype', 'constructor', '__dsh', 'then']);
const reserved = new Set(['tools', 'whenAll', 'whenAny', 'console', 'globalThis', 'Promise', 'Object', 'Array', 'JSON', 'Math', 'String', 'Number', 'Boolean', 'Date', 'Error', 'undefined', 'NaN', 'Infinity']);

/** @brief Validate semantic paths before generating declarations or runtime objects. */
export function validatePath(path: string): void {
    const parts = path.split('.');
    if (parts.length < 2 || parts.some(p => !/^[a-zA-Z_$][\w$]*$/.test(p) || forbidden.has(p)) || reserved.has(parts[0]!)) {
        throw new Error(`Invalid or reserved namespace path: ${path}`);
    }
    // Ask TypeScript's type renderer to quote property names; root keywords are excluded below.
    if (/^(?:const|let|var|function|class|new|delete|return|await|import|export|this|super|default|if|else|switch|case|try|catch|throw|while|for|do|break|continue|yield|void|typeof|instanceof|in|enum|extends|implements|interface|package|private|protected|public|static|with|debugger)$/.test(parts[0]!)) {
        throw new Error(`Reserved namespace root: ${parts[0]}`);
    }
}

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
            this.state = saved;
        }
    }

    refresh(tools: PhysicalTool[]): void {
        if (new Set(tools.map(t => t.id)).size !== tools.length) throw new Error('Duplicate physical tool identity');
        const next = new Map(tools.map(t => [t.id, structuredClone(t)]));
        // Unconfigured names use a hash so sanitization never merges two physical identities.
        this.physical = next;
    }

    snapshot(): RegistryState { return structuredClone(this.state); }

    tools(): PhysicalTool[] { return structuredClone([...this.physical.values()]); }

    effective(): Array<Mapping & { tool: PhysicalTool }> {
        return [...this.physical.values()].map(tool => ({
            id: tool.id,
            path: `unknown.t_${createHash('sha256').update(tool.id).digest('hex')}`,
            aliases: [], enabled: true, authorized: false, pinned: false,
            ...this.state.mappings.find(m => m.id === tool.id), tool,
        }));
    }

    private validateMappings(mappings: Mapping[]): void {
        const ids = new Set<string>();
        const paths: string[] = [];
        for (const m of mappings) {
            if (!m || typeof m.id !== 'string' || ids.has(m.id) || !Array.isArray(m.aliases) || m.aliases.some(a => typeof a !== 'string') || typeof m.enabled !== 'boolean' || typeof m.authorized !== 'boolean' || typeof m.pinned !== 'boolean' || (m.description !== undefined && typeof m.description !== 'string')) throw new Error('Invalid mapping');
            ids.add(m.id);
            for (const path of [m.path, ...m.aliases]) {
                validatePath(path);
                if (path.startsWith('unknown.')) throw new Error('unknown is reserved for unconfigured tools');
                if (paths.some(p => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`))) throw new Error(`Namespace collision: ${path}`);
                paths.push(path);
            }
        }
    }

    private transaction(operation: () => Promise<void>): Promise<void> {
        const result = this.writeChain.then(operation);
        this.writeChain = result.catch(() => {});
        return result;
    }

    async configure(mappings: Mapping[], revision: number): Promise<void> {
        const detached = structuredClone(mappings);
        await this.transaction(async () => {
            if (revision !== this.state.revision) throw new Error('Registry revision conflict; reload before saving');
            this.validateMappings(detached);
            for (const m of detached) {
                if (!this.physical.has(m.id)) throw new Error(`Unknown physical identity: ${m.id}`);
                const old = this.state.mappings.find(o => o.id === m.id);
                if (old?.pinned && (old.path !== m.path || JSON.stringify(old.aliases) !== JSON.stringify(m.aliases))) throw new Error(`Pinned mapping: ${m.id}`);
            }
            for (const old of this.state.mappings) {
                if (old.pinned && !detached.some(m => m.id === old.id)) throw new Error(`Pinned mapping: ${old.id}`);
            }
            const next = { ...this.state, revision: this.state.revision + 1, mappings: detached };
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
            mappings.set(change.id, { enabled: true, authorized: false, pinned: false, aliases: [], ...old, ...change });
        }
        await this.configure([...mappings.values()], proposal.revision);
    }

    declarations(): string {
        const tree: Record<string, unknown> = Object.create(null);
        for (const mapping of this.effective().filter(m => m.enabled)) {
            const doc = (mapping.description ?? mapping.tool.description).replaceAll('*/', '* /');
            const signature = `/** ${doc} */\n(args: ${jsonSchemaToTs(mapping.tool.parameters)}): Promise<${jsonSchemaToTs(mapping.tool.output)}>`;
            for (const path of [mapping.path, ...mapping.aliases]) {
                const parts = path.split('.');
                let node = tree;
                for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
                node[parts.at(-1)!] = signature;
            }
        }
        const render = (node: Record<string, unknown>): string => `{ ${Object.entries(node).map(([k, v]) => typeof v === 'string' ? `${JSON.stringify(k)}: ${v};` : `${JSON.stringify(k)}: ${render(v as Record<string, unknown>)};`).join('\n')} }`;
        return Object.entries(tree).map(([key, value]) => `declare const ${key}: ${render(value as Record<string, unknown>)};`).join('\n');
    }

    roots(): string[] { return [...new Set(this.effective().filter(m => m.enabled).flatMap(m => [m.path, ...m.aliases].map(p => p.split('.')[0]!)))].sort(); }

    async invoke(path: string, args: unknown, dispatch: (id: string, args: unknown) => Promise<unknown>): Promise<unknown> {
        const mapping = this.effective().find(m => m.path === path || m.aliases.includes(path));
        if (!mapping?.enabled || !mapping.authorized) throw new Error(`Execution denied: ${path}`);
        const errors = validateJsonSchemaValue(mapping.tool.parameters as JsonSchemaNode, args);
        if (errors.length) throw new Error(`Invalid arguments: ${errors.join('; ')}`);
        const value = await dispatch(mapping.id, args);
        await this.transaction(async () => {
            const next = this.snapshot();
            const usage = next.usage[mapping.id] ?? { calls: 0, lastUsed: 0, exposures: 0 };
            next.usage[mapping.id] = { ...usage, calls: usage.calls + 1, lastUsed: Date.now() };
            await this.store.save('registry', next);
            this.state = next;
        });
        return value;
    }

    async expose(paths: string[]): Promise<void> {
        await this.transaction(async () => {
            const next = this.snapshot();
            for (const id of new Set(this.effective().filter(m => paths.includes(m.path) || m.aliases.some(a => paths.includes(a))).map(m => m.id))) {
                const usage = next.usage[id] ?? { calls: 0, lastUsed: 0, exposures: 0 };
                next.usage[id] = { ...usage, exposures: usage.exposures + 1 };
            }
            await this.store.save('registry', next);
            this.state = next;
        });
    }
}
