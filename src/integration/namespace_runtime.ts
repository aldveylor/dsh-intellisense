import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import PtcRuntime, { type PtcRunRequest, type PtcRunSpec, type PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime';
import { argumentsFor, resultFor } from './namespace.js';
import type {} from './namespace_plugin.js';
import { RuntimeHost, type RuntimeConfig } from '../runtime/host.js';
import type { z } from 'zod';

/** @brief Settle an IPC callback on cancellation; native run_code still owns and drains the actual tool call. */
async function bindingResult<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([work, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
}

/** @brief The isolated process runtime consumed by the native run_code transport. */
declare module '@deepseek-ai/cordis' { interface Context { codeRuntime: RuntimeHost; codeRuntimeOptions: z.infer<typeof RuntimeConfig> } }

/** @brief Adapt native PTC bindings to Profile namespaces while preserving native dispatch scheduling. */
export class NamespaceRuntime extends PtcRuntime {
    static inject = ['codeRuntimeOptions'];
    readonly language = 'typescript';
    readonly isolation = 'process';
    private sequence = 0;
    private runtime: RuntimeHost;

    constructor(ctx: Context) {
        super(ctx);
        this.runtime = new RuntimeHost(ctx.codeRuntimeOptions);
        ctx.provide('codeRuntime', this.runtime);
        ctx.effect(() => () => this.runtime.dispose());
    }

    override get executionInstructions(): string { return 'Use namespace commands directly, such as std.cwd() and tools.intellisense(["std."]). Each run is an async function body; use await and return. Each execution starts in a fresh context; do not rely on environment continuity. globalThis is unavailable.'; }

    override get timeout(): { defaultMs: number; maxMs: number } {
        const timeoutMs = this.runtime.config.timeoutMs;
        return { defaultMs: timeoutMs, maxMs: timeoutMs };
    }

    /** @brief Validate explicit choices and retain the native transport's owner and binding closures. */
    resolve(request: PtcRunRequest): PtcRunSpec {
        if (request.sandboxPolicy) throw new Error('Namespace runtime does not accept file-policy overrides');
        if (request.timeoutMs !== undefined && (request.timeoutMs === null || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) throw new Error('Expected a positive finite timeoutMs');
        if (!request.stateOwner) throw new Error('run_code requires a live conversation');
        return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: Math.min(request.timeoutMs ?? this.timeout.defaultMs, this.timeout.maxMs) };
    }

    /** @brief Run a complete TS/JS function body with guarded physical-tool binding closures. */
    async run(spec: PtcRunSpec): Promise<PtcRunResult> {
        const agent = spec.stateOwner as Agent;
        const runtime = this.runtime;
        const namespaces = this.ctx.get('commandNamespaces');
        const controller = new AbortController();
        const abort = (): void => controller.abort(spec.signal?.reason);
        spec.signal?.addEventListener('abort', abort, { once: true });
        if (spec.signal?.aborted) abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Runtime execution timed out')); }, spec.timeoutMs!);
        try {
            if (!namespaces) throw new Error('Namespace service is unavailable');
            if (!agent?.id || !agent.ctx || !agent.session) throw new Error('run_code requires a live conversation');
            const bindings = spec.bindings.find(binding => binding.global === 'tools')?.functions;
            if (!bindings) throw new Error('Native PTC tool bindings are required');
            const entries = (await namespaces.entries(agent)).filter(entry => !['tools_profile_annotation', 'tools_profile_commands'].includes(entry.tool));
            const result = await runtime.execute(agent.id, `run-code-${++this.sequence}`, spec.program, entries.map(entry => entry.path), async (path, input, signal) => {
                signal.throwIfAborted();
                const entry = (await namespaces.entries(agent)).find(entry => entry.path === path);
                if (!entry || !Object.hasOwn(bindings, entry.tool)) throw new Error(`Execution denied: ${path}`);
                return resultFor(entry, await bindingResult(bindings[entry.tool]!(argumentsFor(entry, input)), signal));
            }, controller.signal, await namespaces.values(agent));
            return { logs: result.logs, ...(result.value === undefined ? {} : { value: result.value }), ...(result.error ? { error: { kind: 'exception' as const, message: result.error } } : {}) };
        } catch (error) {
            return { logs: [], error: { kind: timedOut ? 'timeout' : spec.signal?.aborted ? 'abort' : 'exception', message: error instanceof Error ? error.message : String(error) } };
        } finally { clearTimeout(timer); spec.signal?.removeEventListener('abort', abort); }
    }

    /** @brief Release the exact session owner's retained process. */
    override async release(owner: object): Promise<void> { await this.runtime.release((owner as Agent).id); }
}
