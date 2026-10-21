import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Environment, ExecutionResult, SessionCheckpoint } from './session.js';
import type { CompletionResult } from '../typescript/completion.js';
import type { Usage } from '../registry/registry.js';

/** @brief A separate permission-restricted Node process owns one persistent REPL and language service. */
export class IsolatedSession {
    private child: ChildProcess;
    private sequence = 0;
    private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
    private dead = false;
    private signal: AbortSignal | undefined;
    private completed = new Map<string, { source: string; promise: Promise<ExecutionResult> }>();

    constructor(private invoke: (path: string, args: unknown, signal?: AbortSignal) => Promise<unknown>, private organize: (signal?: AbortSignal) => Promise<unknown>, private timeoutMs = 30_000) {
        let worker = fileURLToPath(new URL('./worker.js', import.meta.url));
        if (!existsSync(worker)) worker = fileURLToPath(new URL('../../dist/runtime/worker.js', import.meta.url));
        const packageRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
        this.child = fork(worker, [], {
            env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
            execArgv: ['--max-old-space-size=192', '--permission', `--allow-fs-read=${packageRoot}/dist`, `--allow-fs-read=${packageRoot}/node_modules`],
        });
        this.child.on('error', error => this.fail(error));
        this.child.on('exit', (code, signal) => this.fail(new Error(`REPL process exited (${code ?? signal}); in-flight source must not be retried automatically`)));
        this.child.on('message', message => { void this.receive(message); });
        this.child.stderr?.resume();
    }

    private async receive(raw: unknown): Promise<void> {
        const message = raw as { type: string; id: number; path: string; args: unknown; value: unknown; error?: string };
        if (message.type === 'result') {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
        } else if (message.type === 'invoke' || message.type === 'sort') {
            try {
                this.signal?.throwIfAborted();
                if ((JSON.stringify(message.args) ?? '').length > 1_048_576) throw new Error('Tool argument size limit exceeded');
                const value = message.type === 'sort' ? await this.organize(this.signal) : await this.invoke(message.path, message.args, this.signal);
                if (this.child.connected) this.child.send({ type: 'bridge-result', id: message.id, value });
            } catch (error) {
                if (this.child.connected) this.child.send({ type: 'bridge-result', id: message.id, error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    private request<T>(method: string, args: unknown[]): Promise<T> {
        if (this.dead) return Promise.reject(new Error('REPL process is closed; create a new session to continue'));
        const id = ++this.sequence;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error('REPL request timed out; process terminated and in-flight source not retried')), this.timeoutMs);
            this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
            this.child.send({ id, method, args });
        });
    }

    update(environment: Environment): Promise<void> { return this.request('update', [environment]); }

    execute(id: string, source: string, signal?: AbortSignal): Promise<ExecutionResult> {
        const existing = this.completed.get(id);
        if (existing) return existing.source === source ? existing.promise : Promise.reject(new Error('Execution identity reused'));
        const promise = this.executeOnce(id, source, signal);
        this.completed.set(id, { source, promise });
        return promise;
    }

    private async executeOnce(id: string, source: string, signal?: AbortSignal): Promise<ExecutionResult> {
        signal?.throwIfAborted();
        this.signal = signal;
        const abort = (): void => this.fail(new Error('REPL execution cancelled; process terminated'));
        signal?.addEventListener('abort', abort, { once: true });
        try { return await this.request('execute', [id, source]); }
        finally { signal?.removeEventListener('abort', abort); this.signal = undefined; }
    }

    complete(source: string, usage: Record<string, Usage>, identities: Record<string, string>): Promise<CompletionResult> { return this.request('complete', [source, usage, identities]); }
    checkpoint(): Promise<SessionCheckpoint> { return this.request('checkpoint', []); }
    restore(checkpoint: SessionCheckpoint): Promise<void> { return this.request('restore', [checkpoint]); }

    private fail(error: Error): void {
        if (this.dead) return;
        this.dead = true;
        this.child.kill('SIGKILL');
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
    }

    dispose(): void { this.fail(new Error('Session disposed')); }
}
