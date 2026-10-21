import type { BindingType } from '../typescript/project.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmModelInfo, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { Store } from '../storage/store.js';
import type { SemanticRegistry, PhysicalTool } from '../registry/registry.js';
import { IsolatedSession } from '../runtime/isolated.js';
import type { SessionCheckpoint, ExecutionResult } from '../runtime/session.js';
import { environmentPrompt } from '../protocol/prompt.js';
import { runConversation } from '../protocol/controller.js';
import type { OrganizationService } from './organization.js';
import { ExecutionTrace } from './execution_trace.js';

/** @brief Plugin route and the actual upstream model provider stay separate. */
export interface AdapterConfig { route: string; provider: string; model: string; timeoutMs: number; maxContinuations: number }
/** @brief Durable execution status prevents retries from repeating completed or uncertain side effects. */
interface ExecutionRecord { status: 'started' | 'completed' | 'failed'; source?: string; result?: ExecutionResult; error?: string }

/** @brief DSH adapter owning continuation requests without rewriting frozen agent-loop requests. */
export class TypeScriptAdapter extends LlmAdapter {
    private sessions = new Map<string, Promise<IsolatedSession>>();
    private queues = new Map<string, Promise<unknown>>();
    private positions = new Map<string, { turn: number; step: number }>();
    private executions = new Map<string, ExecutionTrace>();

    constructor(private ctx: Context, readonly config: AdapterConfig, private registry: SemanticRegistry, private store: Store, private organization: OrganizationService) {
        super();
        ctx.on('agent/assistant-stream', ({ agent, frame }) => {
            if (frame.type === 'start') this.positions.set(agent.id, { turn: frame.turn, step: frame.step });
            if (frame.type === 'end') this.positions.delete(agent.id);
        });
    }

    override providerInfo(provider: string): { id: string; name: string } { return { id: provider, name: 'TypeScript REPL' }; }

    override async listModels(provider: string): Promise<LlmModelInfo[]> {
        const models = await this.ctx.llm.listModels(this.config.provider);
        return models.map(m => ({ ...m, provider, description: `Persistent TypeScript environment via ${this.config.provider}` }));
    }

    physical(agent?: Agent): PhysicalTool[] {
        const runtime = agent?.ctx.tools ?? this.ctx.tools;
        return runtime.schemas(agent).filter(t => t.name !== 'run_code').map(t => ({ id: t.name, description: t.description, parameters: t.parameters, output: runtime.get(t.name, agent)!.output.schema }));
    }

    refresh(): void {
        const tools = new Map(this.physical().map(t => [t.id, t]));
        for (const agent of this.ctx.agents.list()) for (const tool of this.physical(agent)) tools.set(tool.id, tool);
        this.registry.refresh([...tools.values()]);
    }

    prompt(agent?: Agent, bindings: BindingType[] = []): string {
        this.refresh();
        const allowed = agent ? new Set(this.physical(agent).map(t => t.id)) : undefined;
        const roots = [...new Set(this.registry.effective().filter(m => m.enabled && (!allowed || allowed.has(m.id))).flatMap(m => [m.path, ...m.aliases].map(path => path.split('.')[0]!)))].sort();
        return environmentPrompt(roots, agent ? `Session ${agent.id}. Native const/let bindings persist until this session closes. Runtime data is checkpointed; closures are process-local.` : 'New isolated session.', bindings, this.registry.namespaceHints(allowed), this.registry.namespaceVisibility(allowed));
    }

    private key(session: string): string { return createHash('sha256').update(session).digest('hex'); }

    private session(agent: Agent): Promise<IsolatedSession> {
        let pending = this.sessions.get(agent.id);
        if (!pending) {
            pending = (async () => {
                const runtime = new IsolatedSession(
                    (path, args, signal) => this.registry.invoke(path, args, async (id, value) => {
                        if (this.ctx.agents.get(agent.id) !== agent || !agent.ctx.tools.get(id, agent)) throw new Error('Tool is no longer available in this session');
                        const callId = ToolCallId(`ts-${randomUUID()}`);
                        const auditKey = `dispatch_${this.key(callId)}`;
                        await this.store.save(auditKey, { status: 'started', session: agent.id, callId, physicalId: id, arguments: value });
                        const trace = this.executions.get(agent.id);
                        trace?.start(callId, id, value);
                        const result = await agent.ctx.tools.execute({ callId, name: id, arguments: value, agent, signal: signal ?? new AbortController().signal });
                        trace?.finishCall(callId, id, value, result);
                        await this.store.save(auditKey, { status: 'completed', session: agent.id, callId, physicalId: id, arguments: value, result });
                        if (result.isError) throw new Error(result.error.message);
                        for (const context of result.additionalContexts ?? []) agent.inject(context);
                        return result.value;
                    }),
                    signal => this.organization.propose(agent, signal ?? new AbortController().signal), this.config.timeoutMs,
                );
                const checkpoint = await this.store.load<SessionCheckpoint>(`session_${this.key(agent.id)}`);
                try { if (checkpoint) await runtime.restore(checkpoint); }
                catch (error) { runtime.dispose(); throw error; }
                return runtime;
            })();
            this.sessions.set(agent.id, pending);
        }
        return pending;
    }

    private async run(options: GenerateOptions, emit: (chunk: StreamChunk) => void): Promise<{ text: string; usage: TokenUsage; index: number }> {
        if (!options.sessionId) throw new Error('TypeScript REPL requests require a live DSH session identity');
        const agent = this.ctx.agents.get(options.sessionId);
        if (!agent) throw new Error('No live DSH agent owns this session');
        this.refresh();
        const runtime = await this.session(agent);
        const visible = new Set(this.physical(agent).map(t => t.id));
        const mappings = this.registry.effective().filter(m => visible.has(m.id) && m.enabled);
        const paths = mappings.flatMap(m => [m.path, ...m.aliases]);
        await runtime.update({ declarations: this.registry.declarations(visible), paths });
        const identity = this.key(JSON.stringify({ session: agent.id, messages: options.messages, model: options.model }));
        const executionKey = `execution_${identity}`;
        const previous = await this.store.load<ExecutionRecord>(executionKey);
        if (previous?.status === 'completed') return { text: previous.result!.output, usage: { inputTokens: 0, outputTokens: 0 }, index: 0 };
        if (previous?.status === 'failed') throw new Error(previous.error);
        if (previous?.status === 'started') throw new Error('A prior execution has an uncertain outcome and will not be repeated');
        const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
        const journal: unknown[] = [];
        let nextIndex = 0;
        const upstream: GenerateOptions = {
            ...options, provider: options.provider === this.config.route ? this.config.provider : options.provider, model: options.model || this.config.model,
            tools: [], toolHistory: undefined,
            // The adapter owns this separate internal request; the loop's input remains immutable.
            system: this.prompt(agent, await runtime.declarations()), messages: options.messages.filter(m => m.role !== 'system'),
        };
        const logger = this.ctx.logger('ts-intellisense');
        const response = await runConversation({
            trace: (event, details) => logger.info('%s %s', event, JSON.stringify({ session: agent.id, request: identity, ...details })),
            generate: request => {
                const stream = this.ctx.llm.stream(request);
                return (async function* () {
                    const reasoning = new Map<number, { index: number; text: string }>();
                    /** @brief Give each continuation's reasoning blocks unique outer stream indices. */
                    const open = (index: number) => {
                        let block = reasoning.get(index);
                        if (!block) {
                            block = { index: nextIndex++, text: '' };
                            reasoning.set(index, block);
                            emit({ type: 'block-start', index: block.index, blockType: 'reasoning' });
                        }
                        return block;
                    };
                    try { for await (const chunk of stream) {
                        if (chunk.type === 'block-start' && chunk.blockType === 'reasoning') open(chunk.index);
                        if (chunk.type === 'reasoning-delta') {
                            const block = open(chunk.index);
                            block.text += chunk.text;
                            emit({ ...chunk, index: block.index });
                        }
                        if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') {
                            const block = open(chunk.index);
                            emit({ ...chunk, index: block.index });
                            reasoning.delete(chunk.index);
                        }
                        if (chunk.type === 'usage') {
                            usage.inputTokens += chunk.usage.inputTokens; usage.outputTokens += chunk.usage.outputTokens;
                            for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) if (chunk.usage[key] !== undefined) usage[key] = (usage[key] ?? 0) + chunk.usage[key]!;
                        }
                        yield chunk;
                    } } finally {
                        for (const block of reasoning.values()) emit({ type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } });
                    }
                })();
            },
            complete: async source => {
                const identities = Object.fromEntries(mappings.flatMap(m => [m.path, ...m.aliases].map(path => [path, m.id])));
                const result = await runtime.complete(source, this.registry.snapshot().usage, identities);
                await this.registry.expose(result.candidates.map(c => c.path));
                return result;
            },
            validate: source => runtime.validate(source),
            execute: async (id, source) => {
                if (previous?.status === 'completed') return previous.result!;
                if (previous?.status === 'failed') throw new Error(previous.error);
                await this.store.save<ExecutionRecord>(executionKey, { status: 'started' });
                const position = this.positions.get(agent.id);
                const trace = position ? new ExecutionTrace(agent, position, options, source) : undefined;
                if (trace) this.executions.set(agent.id, trace);
                try {
                    const result = await runtime.execute(id, source, options.signal);
                    trace?.finish(result.output);
                    const checkpoint = await runtime.checkpoint();
                    await this.store.save(`session_${this.key(agent.id)}`, checkpoint);
                    await this.store.save<ExecutionRecord>(executionKey, { status: 'completed', source, result });
                    return result;
                } catch (error) {
                    trace?.finish(error instanceof Error ? error.message : String(error), true);
                    await this.store.save<ExecutionRecord>(executionKey, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
                    throw error;
                } finally { this.executions.delete(agent.id); }
            },
            journal: async record => { journal.push(record); await this.store.save(`continuation_${identity}`, journal); },
        }, upstream, identity, this.config.maxContinuations);
        const text = response.abandoned ? 'Input abandoned without execution.' : response.output;
        return { text, usage, index: nextIndex };
    }

    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (options.purpose) {
            yield* this.ctx.llm.stream({ ...options, provider: this.config.provider });
            return;
        }
        const key = options.sessionId ?? 'missing';
        const prior = this.queues.get(key) ?? Promise.resolve();
        const chunks: StreamChunk[] = [];
        let wake: (() => void) | undefined;
        let settled = false;
        const run = prior.catch(() => {}).then(() => this.run(options, chunk => { chunks.push(chunk); wake?.(); }));
        const settlement = run.then(() => { settled = true; wake?.(); }, () => { settled = true; wake?.(); });
        this.queues.set(key, run);
        try {
            while (!settled || chunks.length) {
                if (chunks.length) yield* chunks.splice(0);
                else await new Promise<void>(resolve => { wake = resolve; });
            }
            await settlement;
            const { text, usage, index } = await run;
            yield { type: 'block-start', index, blockType: 'text' };
            yield { type: 'text-delta', index, text };
            yield { type: 'block-end', index, block: { type: 'text', text } };
            yield { type: 'usage', usage };
            yield { type: 'finish', reason: { kind: 'stop' } };
        } catch (error) {
            this.ctx.logger('ts-intellisense').error('ts.request.error %s', JSON.stringify({ session: key, request: this.key(JSON.stringify({ session: key, messages: options.messages, model: options.model })), error: error instanceof Error ? error.stack ?? error.message : String(error) }));
            throw error;
        } finally {
            await settlement;
            if (this.queues.get(key) === run) this.queues.delete(key);
        }
    }

    async release(sessionId: string): Promise<void> {
        const runtime = await this.sessions.get(sessionId);
        runtime?.dispose(); this.sessions.delete(sessionId);
        this.positions.delete(sessionId); this.executions.delete(sessionId);
    }

    async dispose(): Promise<void> { await Promise.all([...this.sessions.keys()].map(id => this.release(id))); }
}
