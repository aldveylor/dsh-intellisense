import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ContextMessageNode, ConversationNodeContext, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { intellisenseTraceDefinition } from '../../src/management/trajectory/intellisense_trace.js';
import { zh } from '../../src/management/locale/zh.js';
import { enUs } from '../../src/management/locale/en_us.js';

test('completion audit events produce localized trajectory rows with actual marker, query, result and timing', () => {
    const event = {
        type: 'plugin:ts_intellisense/intellisense', ignorable: true, seq: SessionSeq(12), time: 100,
        data: { turn: 1, step: 2, segment: 0, marker: '<|CUSTOM_SENSE|>', sessionId: undefined,
            prefix: 'return await std.fs.read', context: 'std.fs.read', info: 'function read(): Promise<string>;',
            injected: 'data', elapsedMs: 12.4, discardedPrefixLength: 0 },
    };
    for (const dictionary of [zh, enUs]) {
        const definition = intellisenseTraceDefinition(key => dictionary[key]);
        const handler = definition.match;
        assert(typeof handler === 'function');
        assert.deepEqual(handler(event as unknown as SessionEvent), { id: '12', role: 'start' });
        const match: ConversationStartMatch = { event: event as unknown as SessionEvent, role: 'start', location: { kind: 'session' } };
        const context: ConversationNodeContext<ContextMessageNode> = {
            key: 'text-ptc-intellisense:12', kind: definition.kind, id: '12',
            matches: [match], start: match, state: undefined, current: new Map(),
        };
        const state = definition.start(context, match, { previous: () => undefined });
        const row = definition.buildViewNode!({ ...context, state });
        assert(row && row.target === 'trajectory');
        assert(JSON.stringify(row.data).includes(dictionary.intellisense_trace));
        assert(JSON.stringify(row.data).includes('<|CUSTOM_SENSE|>'));
        assert(JSON.stringify(row.data).includes(event.data.prefix));
        assert(JSON.stringify(row.data).includes(event.data.info));
        assert(JSON.stringify(row.data).includes('12 ms'));
        assert.deepEqual(event.data.prefix, 'return await std.fs.read');
    }
});
