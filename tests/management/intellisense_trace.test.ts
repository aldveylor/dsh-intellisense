import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ContextMessageNode, ConversationNodeContext, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { intellisenseTraceDefinition } from '../../src/management/trajectory/intellisense_trace.js';
import { errorTraceDefinition } from '../../src/management/trajectory/error_trace.js';
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

test('terminal protocol failures render their persisted code and message in trajectory', () => {
    const data = { reason: 'error', failure: { code: 'MALFORMED_OUTPUT', message: 'Completion marker requires a command path inside an open exec fence' } };
    const event = { type: 'plugin:ts_intellisense/rewrite', ignorable: true, seq: SessionSeq(13), time: 101, data } as unknown as SessionEvent;
    for (const dictionary of [zh, enUs]) {
        const definition = errorTraceDefinition(key => dictionary[key]);
        assert(typeof definition.match === 'function');
        assert.deepEqual(definition.match(event), { id: '13', role: 'start' });
        assert.equal(definition.match({ ...event, data: { reason: 'error' } } as unknown as SessionEvent), null);
        assert.equal(definition.match({ ...event, ignorable: false } as unknown as SessionEvent), null);
        const match: ConversationStartMatch = { event, role: 'start', location: { kind: 'session' } };
        const context: ConversationNodeContext<ContextMessageNode> = {
            key: 'text-ptc-error:13', kind: definition.kind, id: '13',
            matches: [match], start: match, state: undefined, current: new Map(),
        };
        const state = definition.start(context, match, { previous: () => undefined });
        const row = definition.buildViewNode!({ ...context, state });
        assert(row && row.target === 'trajectory');
        const content = JSON.stringify(row.data);
        assert(content.includes(dictionary.protocol_error));
        assert(content.includes(data.failure.code));
        assert(content.includes(data.failure.message));
    }
});
