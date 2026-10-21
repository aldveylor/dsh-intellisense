import { jsonSchemaToTs, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
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
}

/** @brief Successful physical invocations, independent of completion exposure. */
export interface Usage { calls: number; lastUsed: number; exposures: number }
/** @brief Versioned complete registry state, committed atomically. */
export interface RegistryState { version: 1; revision: number; mappings: Mapping[]; usage: Record<string, Usage> }
/** @brief Structured maintenance proposal; execution policy remains owned by DSH. */
export interface Proposal { revision: number; changes: Array<{ id: string; path: string; aliases?: string[]; description?: string }> }

const forbidden = new Set(['__proto__', 'prototype', 'constructor', '__dsh', 'then']);
const reserved = new Set(['tools', 'console', 'globalThis', 'Promise', 'Object', 'Array', 'JSON', 'Math', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Reflect', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Function', 'eval', 'Intl', 'ArrayBuffer', 'Uint8Array', 'undefined', 'NaN', 'Infinity']);

/** @brief Validate semantic paths before generating declarations or runtime objects. */
export function validatePath(path: string): void {
    const parts = path.split('.');
    if (parts.length < 2 || parts.some(p => !/^[a-zA-Z_$][\w$]*$/.test(p) || forbidden.has(p) || p.startsWith('__dsh')) || reserved.has(parts[0]!)) {
        throw new Error(`Invalid or reserved namespace path: ${path}`);
    }
    // Ask TypeScript's type renderer to quote property names; root keywords are excluded below.
    if (/^(?:const|let|var|function|class|new|delete|return|await|import|export|this|super|default|if|else|switch|case|try|catch|throw|while|for|do|break|continue|yield|void|typeof|instanceof|in|enum|extends|implements|interface|package|private|protected|public|static|with|debugger|null|true|false)$/.test(parts[0]!)) {
        throw new Error(`Reserved namespace root: ${parts[0]}`);
    }
}

/** @brief Encode physical names as readable, collision-free callable identifiers. */
function toolName(id: string): string {
    const name = id.replace(/[^a-zA-Z0-9_]/gu, character => `$${character.codePointAt(0)!.toString(16)}$`);
    return !name || /^[0-9]/.test(name) || forbidden.has(name) || name.startsWith('__dsh') ? `$tool$${name}` : name;
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
            if (!m || typeof m.id !== 'string' || ids.has(m.id) || !Array.isArray(m.aliases) || m.aliases.some(a => typeof a !== 'string') || typeof m.enabled !== 'boolean' || typeof m.pinned !== 'boolean' || (m.description !== undefined && typeof m.description !== 'string')) throw new Error('Invalid mapping');
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
                if (!this.physical.has(m.id) && !this.state.mappings.some(old => old.id === m.id)) throw new Error(`Unknown physical identity: ${m.id}`);
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
            if (old && change.aliases && old.aliases.some(alias => !change.aliases!.includes(alias))) throw new Error(`Stable alias cannot be removed: ${change.id}`);
            mappings.set(change.id, { enabled: true, pinned: false, aliases: [], ...old, ...change });
        }
        await this.configure([...mappings.values()], proposal.revision);
    }

    declarations(allowed?: Set<string>): string {
        const tree: Record<string, unknown> = Object.create(null);
        for (const mapping of this.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id)))) {
            const doc = (mapping.description ?? mapping.tool.description).replaceAll('*/', '* /');
            const signature = `(args: ${jsonSchemaToTs(mapping.tool.parameters)}) => Promise<${jsonSchemaToTs(mapping.tool.output)}>`;
            for (const path of [mapping.path, ...mapping.aliases]) {
                const parts = path.split('.');
                let node = tree;
                for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
                node[parts.at(-1)!] = `/** ${doc} */\n${JSON.stringify(parts.at(-1)!)}: ${signature};`;
            }
        }
        const render = (node: Record<string, unknown>): string => `{ ${Object.entries(node).map(([k, v]) => typeof v === 'string' ? v : `${JSON.stringify(k)}: ${render(v as Record<string, unknown>)};`).join('\n')} }`;
        return Object.entries(tree).map(([key, value]) => `declare const ${key}: ${render(value as Record<string, unknown>)};`).join('\n');
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
