import { randomUUID } from 'node:crypto';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionSeq } from '@deepseek-ai/dsh-session';
import { ToolCallId, createAssistantMessage, createToolResultMessage, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { IntellisenseRecord } from '../protocol/execution_trace.js';
import type { ExecutionResult } from '../runtime/session.js';

/** @brief Records one REPL execution and its nested physical calls in the native trajectory. */
export class ExecutionTrace {
    readonly callId = ToolCallId(`ts-repl-${randomUUID()}`);
    private callSeq?: SessionSeq;
    private settled = false;
    private codes: string[] = [];

    constructor(private agent: Agent, private position: { turn: number; step: number }, private options: GenerateOptions) {}

    /** @brief Persist only the edited suffix so source streaming remains linear in generated code size. */
    updateCode(index: number, source: string, interrupted = false): void {
        const previous = this.codes[index] ?? '';
        if (source === this.codes[index] && !interrupted) return;
        let offset = 0;
        while (offset < source.length && offset < previous.length && source[offset] === previous[offset]) offset++;
        this.agent.session.append('ts-repl/source', {
            ...this.position, callId: this.callId, index, offset, text: source.slice(offset),
            ...(interrupted ? { interrupted: true as const } : {}),
        });
        this.codes[index] = source;
    }

    /** @brief Start the logical REPL call before its first lookup or validated execution. */
    private open(): void {
        if (this.callSeq !== undefined) return;
        this.callSeq = this.agent.session.append('tool/call', {
            ...this.position, callId: this.callId, name: 'ts_repl', arguments: JSON.stringify({ codes: this.codes }),
        }).seq;
    }

    /** @brief Persist the original query and its full structured completion reply as a nested call. */
    intellisense(record: IntellisenseRecord): void {
        const callId = ToolCallId(`${this.callId}:intellisense:${record.round}`);
        const args = { code: record.source };
        if (record.phase === 'request') {
            this.open();
            this.start(callId, 'INTELLISENSE', args);
        } else this.agent.session.append('tool/ptc-dispatch', {
            rootCallId: this.callId, parentCallId: this.callId, subCallId: callId,
            name: 'INTELLISENSE', arguments: args, isError: record.error !== undefined,
            content: [{ type: 'text', text: record.error ?? JSON.stringify(record.result ?? null) }],
            meta: { round: record.round, reused: record.reused ?? false },
        });
    }

    /** @brief Admit the validated program as a real execution only after generation has completed. */
    begin(): void {
        this.open();
    }

    /** @brief Keep every executed program's output, prints, errors and current bindings in the trace. */
    executionResult(id: ToolCallId, source: string, result: ExecutionResult): void {
        this.agent.session.append('tool/ptc-dispatch', {
            rootCallId: this.callId, parentCallId: this.callId, subCallId: id,
            name: 'VM_EXECUTE', arguments: { code: source }, isError: result.error !== undefined,
            content: [{ type: 'text', text: JSON.stringify(result) }],
        });
    }

    /** @brief Commit the complete generated code array once the interactive evaluation has settled. */
    private announce(): void {
        const { agent, position, options } = this;
        const block = { type: 'tool-call' as const, id: this.callId, name: 'ts_repl', arguments: JSON.stringify({ codes: this.codes }) };
        const stream: StreamChunk[] = [{ type: 'block-end', index: 0, block }, { type: 'finish', reason: { kind: 'stop' } }];
        agent.session.append('assistant/message', {
            ...position, message: createAssistantMessage({ content: [block], source: { provider: options.provider, model: options.model } }),
            stream: stream.map(chunk => ({ type: 'chunk', chunk, time: Date.now() })),
        }, { surfaceOp: 'append' });
    }

    /** @brief Record the actual dispatch start before entering native policies and guards. */
    start(callId: ToolCallId, name: string, args: unknown): void {
        this.agent.session.append('tool/ptc-dispatch-start', {
            rootCallId: this.callId, parentCallId: this.callId, subCallId: callId, name, arguments: args,
        });
    }

    /** @brief Preserve the native outcome, including replayable tool presentation metadata. */
    finishCall(callId: ToolCallId, name: string, args: unknown, result: ToolExecutionResult): void {
        this.agent.session.append('tool/ptc-dispatch', {
            rootCallId: this.callId, parentCallId: this.callId, subCallId: callId, name, arguments: args,
            isError: result.isError, content: result.content,
            ...(result.meta === undefined ? {} : { meta: result.meta }),
            ...(result.isError && result.error.info ? { error: result.error.info } : {}),
        });
    }

    /** @brief Close the execution with a paired native result without asking the loop to execute it again. */
    finish(output: string, failed = false): void {
        if (this.settled) return;
        if (this.callSeq === undefined) {
            const index = Math.max(0, this.codes.length - 1);
            this.updateCode(index, this.codes[index] ?? '', true);
            this.settled = true;
            return;
        }
        const content: ContentBlock[] = [{ type: 'text', text: output }];
        this.announce();
        this.agent.session.append('tool/result', {
            ...this.position, message: createToolResultMessage({ callId: this.callId, content, isError: failed }),
            meta: { codes: this.codes },
        }, { surfaceOp: 'append', sourceEventSeqs: [this.callSeq] });
        this.settled = true;
    }
}
