import { randomUUID } from 'node:crypto';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId, createAssistantMessage, createToolResultMessage, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';

/** @brief Records one REPL execution and its nested physical calls in the native trajectory. */
export class ExecutionTrace {
    readonly callId = ToolCallId(`ts-repl-${randomUUID()}`);
    private readonly callSeq;
    private settled = false;

    constructor(private agent: Agent, private position: { turn: number; step: number }, options: GenerateOptions, source: string) {
        const block = { type: 'tool-call' as const, id: this.callId, name: 'ts_repl', arguments: JSON.stringify({ code: source }) };
        const stream: StreamChunk[] = [{ type: 'block-end', index: 0, block }, { type: 'finish', reason: { kind: 'stop' } }];
        agent.session.append('assistant/message', {
            ...position, message: createAssistantMessage({ content: [block], source: { provider: options.provider, model: options.model } }),
            stream: stream.map(chunk => ({ type: 'chunk', chunk, time: Date.now() })),
        }, { surfaceOp: 'append' });
        this.callSeq = agent.session.append('tool/call', { ...position, callId: this.callId, name: block.name, arguments: block.arguments }).seq;
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
        const content: ContentBlock[] = [{ type: 'text', text: output }];
        this.agent.session.append('tool/result', {
            ...this.position, message: createToolResultMessage({ callId: this.callId, content, isError: failed }),
        }, { surfaceOp: 'append', sourceEventSeqs: [this.callSeq] });
        this.settled = true;
    }
}
