import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { dshCompatibility } from '../../src/compatibility/compatibility.js';

/** @brief Execute one raw model call through the selected batch executor. */
export async function executeTool(tools: Context['tools'], input: ToolExecutionInput): Promise<ToolExecutionResult> {
    return dshCompatibility.executeCall(tools, input);
}
