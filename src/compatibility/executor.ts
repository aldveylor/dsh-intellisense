import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
import { CodeRunFailedError, jsonSchemaToTs } from '@deepseek-ai/dsh-tool-executor-ptc';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import type { DshCompatibility } from './contracts.js';

/** @brief Use DSH 0.2.2's executor declarations, batch transport and guarded child pipeline. */
export const compatibility: DshCompatibility = {
    jsonSchemaToTs,
    CodeRunFailedError,
    isBlank: (ctx, agent) => {
        const boundary = ctx.agents.turnBoundaryOf(agent.session);
        return boundary.lastTurn === 0 && boundary.openTurnStartSeq === null;
    },
    presentNative: () => {},
    configureTools: (ctx, select) => {
        const executor = new NativeToolExecutor(ctx);
        return ctx.tools.setExecutor({
            describe: tools => executor.describe(select ? tools.filter(select) : tools),
            execute: input => executor.execute(input),
        });
    },
    presentTools: () => {},
    dispatchTool: async (ctx, input) => {
        const pipeline = new ToolExecutionPipeline(ctx);
        const prepared = await pipeline.prepare(input);
        const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
        return pipeline.complete(prepared.exec, outcome);
    },
    executeCall: async (tools, input) => {
        const batch = await tools.execute({
            agent: input.agent, signal: input.signal, toolSet: input.toolSet,
            calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
        });
        return batch.results[0]!.result;
    },
};
