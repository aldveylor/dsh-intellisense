import { Service, type Context } from '@deepseek-ai/cordis';
import { CodeRunFailedError, defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type {} from './plugin.js';
import { RuntimeHost, type RuntimeConfig } from '../runtime/host.js';
import { ptcToolName } from '../runtime/builtins.js';
import { codeBlock } from '../protocol/code_block.js';
import type { z } from 'zod';

/** @brief Release an IPC callback on cancellation before draining the actual native child call. */
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

/** @brief Scoped namespace execution services, independent of the deployment's default PTC backend. */
declare module '@deepseek-ai/cordis' { interface Context { namespaceRuntime: NamespaceRuntime; codeRuntime: RuntimeHost; codeRuntimeOptions: z.infer<typeof RuntimeConfig> } }

/** @brief Execute namespace programs in isolated processes and dispatch children through native tool guards. */
export class NamespaceRuntime extends Service {
    static inject = ['codeRuntimeOptions', 'commandNamespaces', 'tools'];
    private sequence = 0;
    private runtime: RuntimeHost;

    constructor(ctx: Context) {
        super(ctx, 'namespaceRuntime');
        this.runtime = new RuntimeHost(ctx.codeRuntimeOptions);
        ctx.provide('codeRuntime', this.runtime);
        ctx.effect(() => () => this.runtime.dispose());
        ctx.on('agent/disposed', async ({ agent }) => { await this.runtime.release(agent.id); });
        ctx.tools.register(defineTool({
            name: ptcToolName,
            description: 'Execute an async TypeScript/JavaScript function body with namespace commands such as std.cwd() and tools.intellisense("std."). Pass query strings as separate arguments; tools.intellisense("") queries root namespace members. Use await and explicit return. You may attach variables to globalThis to share state between executions within this conversation. The VM may restart and lose all attached state; continuity is not guaranteed. Function-local declarations do not persist between executions.',
            parameters: {
                code: { type: 'string', required: true, description: 'The async function body to execute.' },
                description: { type: 'string', required: true, description: 'A concise description of the program.' },
                timeoutMs: { type: 'number', description: `Positive elapsed-time budget, capped at ${this.runtime.config.timeoutMs} milliseconds.` },
            },
            output: {
                schema: { type: 'object', additionalProperties: true },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
            },
            presentCall: ({ code, description }) => ({
                card: 'generic', title: description, kind: 'execute', rawInput: code,
                content: [{ type: 'text', text: codeBlock(code, 'typescript') }],
            }),
            execute: ({ code, timeoutMs }, execution) => this.execute(code, execution, timeoutMs),
        }));
    }

    /** @brief Run one program, propagate cancellation and await all native child executions before settling. */
    private async execute(code: string, parent: ToolRunContext, timeoutMs = this.runtime.config.timeoutMs): Promise<{ logs: string[]; result?: z.infer<ReturnType<typeof z.json>> }> {
        const agent = parent.agent;
        const namespaces = this.ctx.commandNamespaces;
        if (!agent || !namespaces.isPtc(agent)) throw new Error('An Intellisense PTC conversation is required');
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Expected a positive finite timeoutMs');
        parent.signal.throwIfAborted();
        const controller = new AbortController();
        const abort = (): void => { if (!controller.signal.aborted) controller.abort(parent.signal.reason); };
        parent.signal.addEventListener('abort', abort, { once: true });
        if (parent.signal.aborted) abort();
        let timedOut = false;
        const timer = setTimeout(() => { if (!controller.signal.aborted) { timedOut = true; controller.abort(new Error('Runtime execution timed out')); } }, Math.min(timeoutMs, this.runtime.config.timeoutMs));
        const pending = new Set<Promise<unknown>>();
        let sequence = 0;
        try {
            const entries = (await namespaces.entries(agent)).filter(entry => !entry.preload);
            const result = await this.runtime.execute(agent.id, `run-code-${++this.sequence}`, code, entries.map(entry => entry.binding()), async (tool, input, signal) => {
                signal.throwIfAborted();
                const work = namespaces.dispatchTool(agent, tool, input, { ...parent, signal: controller.signal }, ++sequence);
                pending.add(work);
                void work.finally(() => { pending.delete(work); }).catch(() => {});
                return bindingResult(work, signal);
            }, controller.signal, await namespaces.values(agent), async () => ({ 'tools.profile.profiles': { ...await namespaces.profileNames(agent) } }));
            if (result.error) throw new Error(result.error + (result.logs.length ? `\nCaptured output:\n${result.logs.join('\n')}` : ''));
            return { logs: result.logs, ...(result.value === undefined ? {} : { result: result.value }) };
        } catch (error) {
            const kind = timedOut ? 'timeout' : parent.signal.aborted ? 'abort' : 'exception';
            throw new CodeRunFailedError(`code run failed (${kind}): ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            clearTimeout(timer);
            parent.signal.removeEventListener('abort', abort);
            controller.abort(new Error('Namespace program settled'));
            await Promise.allSettled([...pending]);
        }
    }
}
