import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { z } from 'zod';
import { ExecutionId, HostMessage, RpcId, RunResult, WorkerMessage, type ExecutionResult, type CommandBinding } from './protocol.js';
import { verifySandbox } from './sandbox.js';

/** @brief Deployment-controlled process budgets; unsupported confinement fails during loading. */
export const RuntimeConfig = z.strictObject({
    timeoutMs: z.number().int().min(100).default(120_000),
    syncTimeoutMs: z.number().int().min(10).default(1000),
    maxOutputBytes: z.number().int().min(1024).default(1_048_576),
    maxMessageBytes: z.number().int().min(1024).default(2_097_152),
    maxPendingCalls: z.number().int().positive().default(64),
    heapMb: z.number().int().min(32).default(192),
    sandboxProbeTimeoutMs: z.number().int().min(100).default(10_000),
    diagnosticChars: z.number().int().positive().default(4096),
});

/** @brief One owner-scoped process, its epoch and all in-flight work. */
interface ProcessState {
    child: ChildProcess;
    epoch: number;
    sequence: number;
    pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>;
    calls: Set<Promise<void>>;
    active?: { id: string; controller: AbortController; invoke(tool: string, args: unknown, signal: AbortSignal): Promise<unknown> };
    closed: boolean;
}

/** @brief Host-owned persistent AsyncFunction processes with validated IPC and hard cancellation. */
export class RuntimeHost {
    readonly config: z.infer<typeof RuntimeConfig>;
    private processes = new Map<string, ProcessState>();
    private epochs = new Map<string, number>();
    private queues = new Map<string, Promise<unknown>>();
    private disposed = false;
    private releasing = new Set<string>();
    private bootstrap?: Promise<string>;

    constructor(config: unknown = {}) { this.config = RuntimeConfig.parse(config); verifySandbox(this.config.sandboxProbeTimeoutMs); }

    /** @brief Expose the next or current generation so a reconstructed process is announced before execution. */
    epoch(owner: string): number { return this.epochs.get(owner) ?? 1; }

    /** @brief Launch one restricted owner process without granting source-file access. */
    private async process(owner: string): Promise<ProcessState> {
        if (this.disposed || this.releasing.has(owner)) throw new Error('Runtime owner is disposed');
        const current = this.processes.get(owner);
        if (current && !current.closed) return current;
        const local = new URL('./worker_bundle.mjs', import.meta.url);
        this.bootstrap ??= readFile(existsSync(local) ? local : new URL('../../dist/runtime/worker_bundle.mjs', import.meta.url), 'utf8');
        const javascript = await this.bootstrap;
        if (this.disposed || this.releasing.has(owner)) throw new Error('Runtime owner is disposed');
        const child = spawn(process.execPath, ['--permission', `--max-old-space-size=${this.config.heapMb}`, '--input-type=module', '-'], {
            env: {}, stdio: ['pipe', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
        });
        child.stdin!.end(javascript);
        const state: ProcessState = { child, epoch: this.epoch(owner), sequence: 0, pending: new Map(), calls: new Set(), closed: false };
        this.processes.set(owner, state);
        let diagnostics = '';
        child.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-this.config.diagnosticChars); });
        child.on('error', error => this.close(owner, state, error));
        child.on('exit', () => this.close(owner, state, new Error(`Runtime process exited; global state was reset${diagnostics ? ': ' + diagnostics : ''}`)));
        child.on('message', raw => {
            const work = this.receive(owner, state, raw);
            state.calls.add(work);
            void work.finally(() => state.calls.delete(work));
        });
        return state;
    }

    /** @brief Validate a frame and resolve only requests belonging to its active owner. */
    private async receive(owner: string, state: ProcessState, raw: unknown): Promise<void> {
        try {
            if (Buffer.byteLength(JSON.stringify(raw)) > this.config.maxMessageBytes) throw new Error('IPC message exceeds configured limit');
            const message = WorkerMessage.parse(raw);
            if (message.type === 'result') {
                const pending = state.pending.get(message.id);
                if (!pending) return;
                state.pending.delete(message.id); clearTimeout(pending.timer);
                if (message.error !== undefined) pending.reject(new Error(message.error)); else pending.resolve(message.value);
                return;
            }
            const active = state.active;
            if (!active || active.id !== message.execution || state.calls.size > this.config.maxPendingCalls) throw new Error('RPC has no active owner or exceeds the pending limit');
            try {
                active.controller.signal.throwIfAborted();
                const value = await active.invoke(message.tool, message.args, active.controller.signal);
                this.send(state, { type: 'reply', id: message.id, value: value === undefined ? undefined : z.json().parse(value) });
            } catch (error) {
                if (!state.closed) this.send(state, { type: 'reply', id: message.id, error: error instanceof Error ? error.message : String(error) });
            }
        } catch (error) { this.close(owner, state, error instanceof Error ? error : new Error(String(error))); }
    }

    /** @brief Bound and validate host frames before writing the IPC channel. */
    private send(state: ProcessState, raw: unknown): void {
        const message = HostMessage.parse(raw);
        if (Buffer.byteLength(JSON.stringify(message)) > this.config.maxMessageBytes) throw new Error('IPC message exceeds configured limit');
        if (state.closed || !state.child.connected) throw new Error('Runtime process is closed');
        state.child.send(message, error => { if (error) state.child.kill('SIGKILL'); });
    }

    /** @brief Correlate one request with a deadline and a mandatory settlement. */
    private request(owner: string, state: ProcessState, raw: object): Promise<unknown> {
        const id = RpcId.parse(++state.sequence);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.close(owner, state, new Error('Runtime request timed out; state was reset')), this.config.timeoutMs);
            state.pending.set(id, { resolve, reject, timer });
            try { this.send(state, { ...raw, id }); }
            catch (error) { this.close(owner, state, error instanceof Error ? error : new Error(String(error))); }
        });
    }

    /** @brief Serialize owner executions; every invocation receives new strict AsyncFunction local bindings. */
    execute(owner: string, id: string, code: string, commands: CommandBinding[], invoke: (tool: string, args: unknown, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, values: Record<string, z.infer<ReturnType<typeof z.json>>> = {}): Promise<ExecutionResult> {
        const previous = this.queues.get(owner) ?? Promise.resolve();
        const work = previous.catch(() => { /* A previous failed run does not prevent a new explicit execution. */ }).then(async () => {
            signal.throwIfAborted();
            if (this.releasing.has(owner)) throw new Error('Runtime owner is disposed');
            const state = await this.process(owner);
            const controller = new AbortController();
            const abort = (): void => this.close(owner, state, new Error('Runtime execution cancelled; state was reset'));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            try {
                await this.request(owner, state, { type: 'init', commands, values, maxOutputBytes: this.config.maxOutputBytes, syncTimeoutMs: this.config.syncTimeoutMs });
                signal.throwIfAborted();
                state.active = { id, controller, invoke };
                const source = `(async function(){"use strict";\n${code}\n})()`;
                const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
                if (compiled.diagnostics?.length) throw new Error(ts.formatDiagnostics(compiled.diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => '', getNewLine: () => '\n' }));
                const result = RunResult.parse(await this.request(owner, state, { type: 'execute', execution: ExecutionId.parse(id), javascript: compiled.outputText }));
                if (result.error?.includes('Script execution timed out')) this.close(owner, state, new Error(result.error));
                return { ...result, epoch: state.epoch };
            } finally {
                await Promise.allSettled([...state.calls]);
                signal.removeEventListener('abort', abort); controller.abort(); state.active = undefined;
            }
        });
        this.queues.set(owner, work);
        void work.finally(() => { if (this.queues.get(owner) === work) this.queues.delete(owner); }).catch(() => { /* The original execute promise reports the failure to its caller. */ });
        return work;
    }

    /** @brief Inspect current global descriptors with the same cancellation and process deadline as execution. */
    async describe(owner: string, path: string, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        const state = this.processes.get(owner);
        if (!state || state.closed) return 'No runtime globals have been initialized.';
        const abort = (): void => this.close(owner, state, new Error('Runtime inspection cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        try { return z.string().parse(await this.request(owner, state, { type: 'describe', path })); }
        finally { signal.removeEventListener('abort', abort); }
    }

    /** @brief Hard-stop execution and reject every outstanding request exactly once. */
    private close(owner: string, state: ProcessState, error: Error): void {
        if (state.closed) return;
        state.closed = true; state.active?.controller.abort(error); state.child.kill('SIGKILL');
        this.epochs.set(owner, state.epoch + 1);
        for (const pending of state.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        state.pending.clear();
    }

    /** @brief Release one owner without restoring or replaying its program state. */
    async release(owner: string): Promise<void> {
        this.releasing.add(owner);
        try {
            const state = this.processes.get(owner);
            if (state) {
                const exited = !state.child.pid || state.child.exitCode !== null || state.child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => state.child.once('exit', () => resolve()));
                this.close(owner, state, new Error('Runtime owner released'));
                await Promise.allSettled([...state.calls]);
                await exited;
            }
            await this.queues.get(owner)?.catch(() => {});
            this.processes.delete(owner);
            this.queues.delete(owner);
            this.epochs.delete(owner);
        } finally { this.releasing.delete(owner); }
    }

    /** @brief Unload all processes and pending requests before the plugin disappears. */
    async dispose(): Promise<void> { this.disposed = true; await Promise.all([...new Set([...this.processes.keys(), ...this.queues.keys(), ...this.epochs.keys()])].map(owner => this.release(owner))); }
}
