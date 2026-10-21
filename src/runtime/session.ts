import vm from 'node:vm';
import { inspect } from 'node:util';
import { serialize, deserialize } from 'node:v8';
import { TypeScriptProject, type BindingType } from '../typescript/project.js';

/** @brief Completed result and visible REPL output, with source mapping information. */
export interface ExecutionResult { output: string; declarations: BindingType[]; sourceMap?: string; sourceMaps?: string[] }
/** @brief Explicit durable data checkpoint; executable closures are never replayed. */
export interface SessionCheckpoint { version: 1; data: string; types: BindingType[]; omitted: string[] }
/** @brief Tool binding surface supplied separately from the invocation capability. */
export interface Environment { declarations: string; paths: string[] }

/** @brief Persistent TS REPL; this VM is a semantic boundary, not a hostile-code sandbox. */
export class SessionRuntime {
    readonly project = new TypeScriptProject();
    private context: vm.Context;
    private types = new Map<string, BindingType>();
    private environment: Environment = { declarations: '', paths: [] };
    private roots = new Set<string>();
    private completed = new Map<string, { source: string; result: Promise<ExecutionResult> }>();
    private queue: Promise<unknown> = Promise.resolve();
    private logs: string[] = [];

    constructor(private invoke: (path: string, args: unknown) => Promise<unknown>, private organize: () => Promise<unknown> = async () => { throw new Error('Organization is unavailable'); }) {
        this.context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
        Object.defineProperty(this.context, 'console', { value: Object.freeze({ log: (...values: unknown[]) => this.logs.push(values.map(v => this.format(v)).join(' ')) }) });
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
            if (this.types.has(root)) throw new Error(`Namespace collides with session binding: ${root}`);
            Object.defineProperty(this.context, root, { value, configurable: true });
            this.roots.add(root);
        }
    }

    declarations(): BindingType[] { return [...this.types.values()]; }

    /** @brief Compile a proposed segment without executing or recording an execution identity. */
    validate(source: string): string | undefined {
        try { this.project.compile(source, this.declarations(), this.environment.declarations); }
        catch (error) { return (error instanceof Error ? error.message : String(error)).slice(0, 16_384); }
        return undefined;
    }

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
        const compiled = this.project.compile(source, this.declarations(), this.environment.declarations);
        for (const binding of compiled.bindings) {
            if (this.roots.has(binding.name) || ['tools', 'Promise', 'console', 'globalThis'].includes(binding.name)) throw new Error(`Reserved binding: ${binding.name}`);
            const previous = this.types.get(binding.name);
            if (previous && (previous.kind !== 'var' || binding.kind !== 'var')) throw new SyntaxError(`Identifier '${binding.name}' has already been declared`);
        }
        this.logs = [];
        try {
            let value: unknown;
            for (const unit of compiled.units) {
                value = await new vm.Script(unit.javascript, { filename: 'segment.ts' }).runInContext(this.context, { timeout: 1000 });
                if (unit.mode === 'binding') {
                    Object.defineProperty(this.context, '__dshValue', { value, configurable: true });
                    try { new vm.Script(unit.binding!, { filename: 'segment.ts' }).runInContext(this.context, { timeout: 1000 }); }
                    finally { delete this.context.__dshValue; }
                }
                if (unit.display && value !== undefined) this.logs.push(this.format(value));
            }
            return { output: this.logs.join('\n'), declarations: [...this.declarations(), ...compiled.bindings], sourceMap: compiled.sourceMap, sourceMaps: compiled.sourceMaps };
        } finally {
            for (const binding of compiled.bindings) {
                try {
                    new vm.Script(binding.name).runInContext(this.context, { timeout: 1000 });
                    this.types.set(binding.name, binding);
                } catch { /* Uninitialized native lexical bindings are intentionally not advertised. */ }
            }
        }
    }

    private format(value: unknown): string {
        if (typeof value === 'string') return value.slice(0, 16_384);
        return inspect(value, { depth: 4, maxArrayLength: 50, maxStringLength: 4096, getters: false, customInspect: false }).slice(0, 16_384);
    }

    checkpoint(): SessionCheckpoint {
        const entries: Array<[string, unknown]> = [];
        const omitted: string[] = [];
        for (const binding of this.types.values()) {
            try {
                const value: unknown = new vm.Script(binding.name).runInContext(this.context, { timeout: 1000 });
                serialize(value); entries.push([binding.name, value]);
            } catch { omitted.push(binding.name); }
        }
        return { version: 1, data: serialize(entries).toString('base64'), types: this.declarations().filter(b => !omitted.includes(b.name)), omitted };
    }

    restore(checkpoint: SessionCheckpoint): void {
        if (checkpoint.version !== 1 || this.types.size) throw new Error('Invalid checkpoint or session already initialized');
        const entries = new Map(deserialize(Buffer.from(checkpoint.data, 'base64')) as Array<[string, unknown]>);
        for (const binding of checkpoint.types) {
            if (!/^[a-zA-Z_$][\w$]*$/.test(binding.name) || !['const', 'let', 'var'].includes(binding.kind)) throw new Error('Invalid checkpoint binding');
            Object.defineProperty(this.context, '__dshValue', { value: entries.get(binding.name), configurable: true });
            try { new vm.Script(`${binding.kind} ${binding.name} = __dshValue`).runInContext(this.context); }
            finally { delete this.context.__dshValue; }
            this.types.set(binding.name, binding);
        }
    }

    dispose(): void { this.project.dispose(); this.types.clear(); this.completed.clear(); }
}
