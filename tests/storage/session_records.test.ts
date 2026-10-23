import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendPluginRecord, Session, SessionId } from '@deepseek-ai/dsh-session';
import { releasedV4SessionFormatCodec, assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4';
import { serializeSessionLog } from '@deepseek-ai/dsh-session-log-export';
import { senseRecord } from '../../src/protocol/session_records.js';
import '../../src/protocol/events.js';

test('completion records survive current Session framing and log export admission', () => {
    const session = Session.create(SessionId('completion-export'));
    appendPluginRecord(session, 'plugin:ts_intellisense/intellisense', {
        turn: 1, step: 1, segment: 0, sessionId: session.id, marker: '<|INTELLISENSE|>',
        prefix: 'return await std.cwd', context: 'std.cwd', info: 'function cwd(): string;',
        injected: '<intellisense-data>signature</intellisense-data>', elapsedMs: 1, discardedPrefixLength: 0,
    });
    appendPluginRecord(session, 'plugin:ts_intellisense/context', { turn: 1, step: 1, instructions: 'prompt', provider: 'fake', model: 'test', epoch: 1 });
    appendPluginRecord(session, 'plugin:ts_intellisense/rewrite', { turn: 1, step: 1, original: ['done'], code: '', hash: '', discardedTail: '', discardedBlocks: [], reason: 'prose' });
    const events = session.snapshotEvents();
    for (const event of events) {
        const row = releasedV4SessionFormatCodec.encodeEvent(JSON.parse(JSON.stringify(event)));
        assert.doesNotThrow(() => assertV4RowAdmission(row));
        assert.equal(row.ignorable, true);
    }
    const text = serializeSessionLog(session.header, events);
    assert.equal(text.trim().split('\n').length, 4);
    assert.equal(senseRecord(JSON.parse(text.split('\n')[1]!))?.prefix, 'return await std.cwd');
    assert.equal(senseRecord({ type: 'plugin:ts_intellisense/intellisense', ignorable: true, data: {} }), undefined);
});
