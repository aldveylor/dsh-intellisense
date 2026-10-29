import * as tools from '@deepseek-ai/dsh-tools';
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { DshCompatibility } from './contracts.js';

/** @brief Describe only the retired methods at the compatibility boundary. */
interface LegacyTools {
    presentAs(mode: 'native'): () => void;
    execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

const exports = tools as unknown as Pick<DshCompatibility, 'jsonSchemaToTs' | 'CodeRunFailedError'>;

/** @brief Use DSH 0.2.1's registry-owned invocation and mutable prompt declarations. */
export const compatibility: DshCompatibility = {
    jsonSchemaToTs: exports.jsonSchemaToTs,
    CodeRunFailedError: exports.CodeRunFailedError,
    presentNative: ctx => { (ctx.tools as unknown as LegacyTools).presentAs('native'); },
    configureTools: () => () => {},
    presentTools: (assembly, agent, names) => {
        const selected = new Set(names);
        (assembly as { tools: unknown[] }).tools = agent.ctx.tools.schemas(agent).filter(tool => selected.has(tool.name));
    },
    dispatchTool: (ctx, input) => (ctx.tools as unknown as LegacyTools).execute(input),
    executeCall: (runtime, input) => (runtime as unknown as LegacyTools).execute(input),
};
