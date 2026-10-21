import vm from 'node:vm';
import { inspect } from 'node:util';
import { isProxy } from 'node:util/types';
import { serialize, deserialize } from 'node:v8';
import { TypeScriptProject, type BindingType } from '../typescript/project.js';

/** @brief Completed result and visible REPL output, with source mapping information. */
export interface ExecutionResult { output: string; declarations: BindingType[]; prints?: string[]; error?: string; restarted?: boolean; sourceMap?: string; sourceMaps?: string[] }
/** @brief Explicit durable data checkpoint; executable closures are never replayed. */
export interface SessionCheckpoint { version: 1; data: string; types: BindingType[]; omitted: string[] }
/** @brief Tool binding surface supplied separately from the invocation capability. */
export interface Environment { declarations: string; paths: string[] }

/** @brief A fixed restart callback unwinds the active program before the context is replaced. */
class RestartSignal extends Error {}

/** @brief Per-program output and an optional fully validated context-transfer checkpoint. */
interface RuntimeFeedback { prints: string[]; bindings: BindingType[]; restart?: SessionCheckpoint }

/** @brief Persistent TS REPL; this VM is a semantic boundary, not a hostile-code sandbox. */
export class SessionRuntime {
    readonly project = new TypeScriptProject();
    private context: vm.Context;
    private types = new Map<string, BindingType>();
    private environment: Environment = { declarations: '', paths: [] };
    private roots = new Set<string>();
    private completed = new Map<string, { source: string; result: Promise<ExecutionResult> }>();
    private queue: Promise<unknown> = Promise.resolve();
    private feedback?: RuntimeFeedback;

    constructor(private invoke: (path: string, args: unknown) => Promise<unknown>) {
        this.context = this.createContext();
    }

    /** @brief Install immutable VM-owned callbacks independently of the configurable tool registry. */
    private createContext(): vm.Context {
        const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
        new vm.Script('delete globalThis.console').runInContext(context);
        Object.defineProperty(context, 'vm', { value: Object.freeze({
            print: (...values: unknown[]): void => {
                if (!this.feedback) throw new Error('vm.print requires an active execution');
                this.feedback.prints.push(values.map(value => this.format(value)).join(' '));
            },
            restart: (preserve: readonly string[] = []): never => {
                if (!this.feedback) throw new Error('vm.restart requires an active execution');
                if (!Array.isArray(preserve) || preserve.some(name => typeof name !== 'string')) throw new Error('vm.restart expects an array of variable names');
                const bindings = new Map(this.feedback.bindings.map(binding => [binding.name, binding]));
                const types = [...new Set(preserve)].map(name => {
                    const binding = bindings.get(name);
                    if (!binding) throw new Error(`Cannot preserve unknown VM binding: ${name}`);
                    return binding;
                });
                const entries = types.map(binding => [binding.name, new vm.Script(binding.name).runInContext(this.context, { timeout: 1000 })]);
                this.feedback.restart = { version: 1, data: serialize(entries).toString('base64'), types, omitted: [] };
                throw new RestartSignal();
            },
        }) });
        return context;
    }

    update(environment: Environment): void {
        if (environment.paths.some(path => path === 'vm' || path.startsWith('vm.'))) throw new Error('The vm namespace is reserved for fixed built-in callbacks');
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

    /** @brief Read actual VM names without invoking property getters or proxy traps. */
    members(path: string): string[] | undefined {
        if (!path) {
            const global = new vm.Script('globalThis').runInContext(this.context, { timeout: 1000 }) as object;
            return [...new Set([...Object.getOwnPropertyNames(global), ...this.types.keys()])];
        }
        if (!/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/.test(path)) return undefined;
        const [root, ...parts] = path.split('.');
        let value: unknown;
        try { value = new vm.Script(root!).runInContext(this.context, { timeout: 1000 }); }
        catch { return undefined; }
        for (const part of parts) {
            if (value === null || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) return undefined;
            const descriptor = Object.getOwnPropertyDescriptor(value, part);
            if (!descriptor || !('value' in descriptor)) return undefined;
            value = descriptor.value;
        }
        if (value === null || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) return undefined;
        const names = new Set<string>();
        for (let node: object | null = value; node && !isProxy(node); node = Object.getPrototypeOf(node) as object | null) {
            for (const name of Object.getOwnPropertyNames(node)) names.add(name);
        }
        return [...names];
    }


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
            if (this.roots.has(binding.name) || ['vm', 'tools', 'Promise', 'globalThis'].includes(binding.name)) throw new Error(`Reserved binding: ${binding.name}`);
            const previous = this.types.get(binding.name);
            if (previous && (previous.kind !== 'var' || binding.kind !== 'var')) throw new SyntaxError(`Identifier '${binding.name}' has already been declared`);
        }
        const output: string[] = [];
        const feedback: RuntimeFeedback = { prints: [], bindings: [...this.declarations(), ...compiled.bindings] };
        this.feedback = feedback;
        let failure: string | undefined;
        try {
            let value: unknown;
            for (const unit of compiled.units) {
                value = await new vm.Script(unit.javascript, { filename: 'segment.ts' }).runInContext(this.context, { timeout: 1000 });
                if (unit.mode === 'binding') {
                    Object.defineProperty(this.context, '__dshValue', { value, configurable: true });
                    try { new vm.Script(unit.binding!, { filename: 'segment.ts' }).runInContext(this.context, { timeout: 1000 }); }
                    finally { delete this.context.__dshValue; }
                }
                if (unit.display && value !== undefined) output.push(this.format(value));
            }
        } catch (error) {
            if (!(error instanceof RestartSignal)) failure = error instanceof Error || (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error);
        } finally {
            this.feedback = undefined;
            for (const binding of compiled.bindings) {
                try {
                    new vm.Script(binding.name).runInContext(this.context, { timeout: 1000 });
                    this.types.set(binding.name, binding);
                } catch { /* Uninitialized native lexical bindings are intentionally not advertised. */ }
            }
            if (feedback.restart) {
                this.types.clear();
                this.roots.clear();
                this.context = this.createContext();
                this.update(this.environment);
                this.restore(feedback.restart);
            }
        }
        return {
            output: failure || feedback.restart ? '' : output.join('\n'), declarations: this.declarations(),
            ...(feedback.prints.length ? { prints: feedback.prints } : {}), ...(failure ? { error: failure } : {}),
            ...(feedback.restart ? { restarted: true } : {}), sourceMap: compiled.sourceMap, sourceMaps: compiled.sourceMaps,
        };
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
