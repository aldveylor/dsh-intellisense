import type { ToolExecutionInput, ToolExecutionResult, ToolsService } from '@deepseek-ai/dsh-tools';

/** @brief Execute one raw model call through the selected batch executor. */
export async function executeTool(tools: ToolsService, input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const batch = await tools.execute({
        agent: input.agent, signal: input.signal, toolSet: input.toolSet,
        calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
    });
    return batch.results[0]!.result;
}
