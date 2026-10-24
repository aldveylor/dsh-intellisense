import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ContextMessageNode, ConversationNodeContext, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { builtinTraceDefinition, codeBlock } from '../../src/management/trajectory/builtin_trace.js';
import { enUs } from '../../src/management/locale/en_us.js';

test('builtin trajectory details retain schemas and render declarations inside a safe code fence', () => {
    const definition = builtinTraceDefinition(key => enUs[key]);
    const data = { name: 'tools.intellisense', callId: 'call-1', schema: '{"parameters":{"queries":{"type":"array"}}}', arguments: '{"queries":["std."]}', result: 'declare namespace global { /* ``` */ }', language: 'typescript', elapsedMs: 4.2, isError: false };
    const event = { type: 'plugin:ts_intellisense/builtin', ignorable: true, seq: SessionSeq(8), time: 100, data } as unknown as SessionEvent;
    assert.equal(typeof definition.match, 'function');
    const match = definition.match as (event: SessionEvent) => unknown;
    assert.deepEqual(match(event), { id: '8', role: 'start' });
    assert.equal(match({ ...event, data: { ...data, schema: 3 } } as unknown as SessionEvent), null);
    const start: ConversationStartMatch = { event, role: 'start', location: { kind: 'session' } };
    const context: ConversationNodeContext<ContextMessageNode> = { key: 'builtin:8', kind: definition.kind, id: '8', matches: [start], start, state: undefined, current: new Map() };
    const state = definition.start(context, start, { previous: () => undefined });
    const result = definition.buildViewNode!({ ...context, state });
    const text = JSON.stringify(result);
    assert(text.includes('Schema'));
    assert(text.includes('````typescript'));
    assert(text.includes('declare namespace global'));
    assert(text.includes('4 ms'));
    assert.equal(codeBlock('plain', 'text'), '```text\nplain\n```');
});
