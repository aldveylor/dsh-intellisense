import { normalizeError } from '../error.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import type {} from '../protocol/events.js';

/** @brief Record the actual builtin contract and result without changing model-facing content. */
export function registerBuiltin(ctx: Context, definition: ToolDefinition): () => void {
    return ctx.tools.register({
        ...definition,
        execute: async (args, execution) => {
            const started = performance.now();
            let result: unknown;
            let error: string | undefined;
            try { result = await definition.execute(args, execution); return result; }
            catch (failure) { const normalized = normalizeError(failure); error = normalized instanceof Error ? normalized.message : String(normalized); throw normalized; }
            finally {
                const agent = execution.agent;
                if (agent) appendPluginRecord(agent.session, 'plugin:ts_intellisense/builtin', {
                    name: definition.name.replace(/^tools_/, 'tools.').replace(/^tools\.profile_/, 'tools.profile.'),
                    callId: String(execution.callId),
                    schema: JSON.stringify({ name: definition.name, description: definition.description, parameters: definition.parameters, output: definition.output.schema }, null, 2),
                    arguments: JSON.stringify(args, null, 2),
                    result: error ?? (typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? ''),
                    language: error !== undefined ? 'text' : ['tools_inspect', 'tools_profile_annotation'].includes(definition.name)
                        && agent.ctx.get('agentSessionAddition')!.isPtc(agent) ? 'typescript' : 'json',
                    elapsedMs: performance.now() - started,
                    isError: error !== undefined,
                });
            }
        },
    });
}
