import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';

/** @brief Stable operations shared by the registry-owned and executor-owned DSH tool APIs. */
export interface DshCompatibility {
    /** @brief Render the host-provided TypeScript declaration for a JSON Schema. */
    jsonSchemaToTs(schema: unknown): string;
    /** @brief Preserve the host generation's structured program failure type. */
    CodeRunFailedError: new (message: string) => Error;

    /** @brief Check whether a session has entered any model turn. */
    isBlank(ctx: Context, agent: Agent): boolean;

    /** @brief Declare native transport in a presentation scope when required by the host. */
    presentNative(ctx: Context): void;
    /** @brief Install model-call execution and optionally filter its declared definitions. */
    configureTools(ctx: Context, select?: (tool: ToolDefinition) => boolean): () => void;
    /** @brief Apply declarations at the host's prompt boundary when the assembly owns them. */
    presentTools(assembly: object, agent: Agent, names: readonly string[]): void;
    /** @brief Dispatch one parsed child call with the host's policy, cancellation and result handling. */
    dispatchTool(ctx: Context, input: ToolExecutionInput): Promise<ToolExecutionResult>;
    /** @brief Normalize a single model call across the single-call and batch execution APIs. */
    executeCall(tools: Context['tools'], input: ToolExecutionInput): Promise<ToolExecutionResult>;
}
