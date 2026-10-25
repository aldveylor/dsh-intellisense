import type { ContextMessageNode, ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client';
import type { BuiltinEvent } from '../../protocol/events.js';
import type { LocaleKey } from '../locale/locale.js';
import { codeBlock } from '../../protocol/code_block.js';

export { codeBlock } from '../../protocol/code_block.js';

/** @brief Validate durable builtin records before projecting them into the trajectory. */
function builtinRecord(event: { type: string; data: unknown; ignorable?: boolean }): BuiltinEvent | undefined {
    if (event.type !== 'plugin:ts_intellisense/builtin' || event.ignorable !== true || !event.data || typeof event.data !== 'object') return;
    const value = event.data as Partial<BuiltinEvent>;
    if (![value.name, value.callId, value.schema, value.arguments, value.result].every(field => typeof field === 'string')
        || !['typescript', 'json', 'text'].includes(value.language ?? '') || typeof value.elapsedMs !== 'number' || typeof value.isError !== 'boolean') return;
    return value as BuiltinEvent;
}

