import vm from 'node:vm';
import { inspect } from 'node:util';
import { serialize, deserialize } from 'node:v8';
import { TypeScriptProject, type BindingType } from '../typescript/project.js';

/** @brief Completed result and visible REPL output, with source mapping information. */
export interface ExecutionResult { output: string; declarations: BindingType[]; sourceMap?: string }
/** @brief Explicit durable data checkpoint; executable closures are never replayed. */
export interface SessionCheckpoint { version: 1; data: string; types: BindingType[]; omitted: string[] }
/** @brief Tool binding surface supplied separately from the invocation capability. */
export interface Environment { declarations: string; paths: string[] }
/** @brief Stored lexical slot implementing const writes and temporal dead zones. */
interface Slot { kind: BindingType['kind']; initialized: boolean; value: unknown }

/** @brief Persistent TS REPL; this VM is a semantic boundary, not a hostile-code sandbox. */
export class SessionRuntime {
    readonly project = new TypeScriptProject();
    private context: vm.Context;
    private slots = new Map<string, Slot>();
    private types = new Map<string, BindingType>();
    private environment: Environment = { declarations: '', paths: [] };
    private roots = new Set<string>();
    private completed = new Map<string, { source: string; result: Promise<ExecutionResult> }>();
    private queue: Promise<unknown> = Promise.resolve();
    private logs: string[] = [];

    constructor(private invoke: (path: string, args: unknown) => Promise<unknown>, private organize: () => Promise<unknown> = async () => { throw new Error('Organization is unavailable'); }) {
        const scope = new Proxy(Object.create(null) as Record<string, unknown>, {
            get: (_target, name) => {
                const slot = this.slots.get(String(name));
                if (!slot) throw new ReferenceError(`${String(name)} is not defined`);
                if (!slot.initialized) throw new ReferenceError(`Cannot access '${String(name)}' before initialization`);
                return slot.value;
            },
            set: (_target, name, value) => {
                const slot = this.slots.get(String(name));
                if (!slot?.initialized) throw new ReferenceError(`${String(name)} is not initialized`);
                if (slot.kind === 'const') throw new TypeError(`Assignment to constant variable: ${String(name)}`);
                slot.value = value;
                return true;
            },
        });
        this.context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
        const bridge = Object.freeze({
            scope,
            define: (name: string, kind: BindingType['kind']) => {
                if (this.slots.has(name)) throw new SyntaxError(`Binding already exists: ${name}`);
                this.slots.set(name, { kind, initialized: kind === 'var', value: undefined });
            },
            initialize: (name: string, value: unknown) => {
                const slot = this.slots.get(name)!;
                slot.value = value;
                slot.initialized = true;
            },
        });
        Object.defineProperty(this.context, '__dsh', { value: bridge });
        Object.defineProperty(this.context, 'console', { value: Object.freeze({ log: (...values: unknown[]) => this.logs.push(values.map(v => this.format(v)).join(' ')) }) });
        Object.defineProperty(this.context, 'whenAll', { value: (values: unknown[]) => Promise.all(values) });
        Object.defineProperty(this.context, 'whenAny', { value: (values: unknown[]) => Promise.race(values) });
        Object.defineProperty(this.context, 'tools', { value: Object.freeze({ sort: () => this.organize() }) });
    }

    update(environment: Environment): void {
        this.environment = environment;
        for (const root of this.roots) delete this.context[root];
        this.roots.clear();
        const tree: Record<string, unknown> = Object.create(null);
        for (const path of environment.paths) {
            const parts = path.split('.');
            let node = tree;
            for (const part of parts.slice(0, -1)) node = (node[part] ??= Object.create(null)) as Record<string, unknown>;
            node[parts.at(-1)!] = (args: unknown) => this.invoke(path, args);
        }
        const freeze = (value: Record<string, unknown>): void => {
            for (const child of Object.values(value)) if (typeof child === 'object' && child !== null) freeze(child as Record<string, unknown>);
            Object.freeze(value);
        };
        freeze(tree);
        for (const [root, value] of Object.entries(tree)) {
            if (this.slots.has(root)) throw new Error(`Namespace collides with session binding: ${root}`);
            Object.defineProperty(this.context, root, { value, configurable: true });
            this.roots.add(root);
        }
    }

    declarations(): BindingType[] { return [...this.types.values()]; }

    execute(id: string, source: string): Promise<ExecutionResult> {
        const old = this.completed.get(id);
        if (old) {
            if (old.source !== source) return Promise.reject(new Error('Execution identity reused with different source'));
            return old.result;
        }
        const result = this.queue.then(() => this.run(source));
        this.queue = result.catch(() => {});
        this.completed.set(id, { source, result });
        return result;
    }

    private async run(source: string): Promise<ExecutionResult> {
        if (source.includes('<|')) throw new Error('Protocol markers cannot be executed');
        if (/\b__dsh\w*/.test(source)) throw new Error('Reserved runtime identifier');
        const deletion = /^\s*del\s+([a-zA-Z_$][\w$]*)\s*;?\s*$/.exec(source);
        if (deletion) {
            if (!this.slots.delete(deletion[1]!)) throw new ReferenceError(`Unknown binding: ${deletion[1]}`);
            this.types.delete(deletion[1]!);
            return { output: '', declarations: this.declarations() };
        }
        const compiled = this.project.compile(source, this.declarations(), this.environment.declarations);
        for (const binding of compiled.bindings) {
            if (this.roots.has(binding.name) || ['tools', 'whenAll', 'whenAny', 'console', 'globalThis'].includes(binding.name)) throw new Error(`Reserved binding: ${binding.name}`);
        }
        this.logs = [];
        try {
            const script = new vm.Script(`(async () => {\n"use strict";\n${compiled.javascript}\n})()`, { filename: 'segment.ts' });
            const value = await script.runInContext(this.context, { timeout: 1000 });
            if (value !== undefined) this.logs.push(this.format(value));
            return { output: this.logs.join('\n'), declarations: [...this.declarations(), ...compiled.bindings], sourceMap: compiled.sourceMap };
        } finally {
            for (const binding of compiled.bindings) if (this.slots.has(binding.name)) this.types.set(binding.name, binding);
        }
    }

    private format(value: unknown): string {
        if (typeof value === 'string') return value.slice(0, 16_384);
        return inspect(value, { depth: 4, maxArrayLength: 50, maxStringLength: 4096, getters: false, customInspect: false }).slice(0, 16_384);
    }

    checkpoint(): SessionCheckpoint {
        const entries: Array<[string, Slot]> = [];
        const omitted: string[] = [];
        for (const [name, slot] of this.slots) {
            try { serialize(slot); entries.push([name, slot]); }
            catch { omitted.push(name); }
        }
        return { version: 1, data: serialize(entries).toString('base64'), types: this.declarations().filter(b => !omitted.includes(b.name)), omitted };
    }

    restore(checkpoint: SessionCheckpoint): void {
        if (checkpoint.version !== 1 || this.slots.size) throw new Error('Invalid checkpoint or session already initialized');
        this.slots = new Map(deserialize(Buffer.from(checkpoint.data, 'base64')) as Array<[string, Slot]>);
        this.types = new Map(checkpoint.types.map(t => [t.name, t]));
    }

    dispose(): void { this.project.dispose(); this.slots.clear(); this.completed.clear(); }
}
