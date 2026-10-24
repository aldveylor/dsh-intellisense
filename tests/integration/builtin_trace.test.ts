import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { registerBuiltin } from '../../src/integration/builtin_trace.js';

test('builtin recording captures the actual contract and preserves canonical results and failures', async () => {
    let registered: ToolDefinition | undefined;
    const session = Session.create(SessionId('builtin-trace'));
    const records = (): { type: string; data: Record<string, unknown> }[] => session.snapshotEvents() as unknown as { type: string; data: Record<string, unknown> }[];
    const ctx = { tools: { register: (definition: ToolDefinition) => { registered = definition; return () => {}; } } } as unknown as Context;
    const execution = { callId: 'call-1', agent: { ctx: { commandNamespaces: { isPtc: () => true } }, session } } as unknown as ToolRunContext;
    registerBuiltin(ctx, defineTool({ name: 'tools_profile_annotation', description: 'Profile declarations', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'interface Profile {}' }));
    assert.equal(await registered!.execute({}, execution), 'interface Profile {}');
    assert.equal(records()[0]!.type, 'plugin:ts_intellisense/builtin');
    assert.equal(records()[0]!.data.language, 'typescript');
    assert.equal(records()[0]!.data.name, 'tools.profile.annotation');
    assert.equal(JSON.parse(records()[0]!.data.schema as string).output.type, 'string');
    const failure = new Error('save failed');
    registerBuiltin(ctx, defineTool({ name: 'tools_profile_save', description: 'Save', parameters: {}, output: { schema: { type: 'null' }, render: () => [] }, execute: async () => { throw failure; } }));
    await assert.rejects(registered!.execute({}, execution), error => error === failure);
    assert.equal(records()[1]!.data.isError, true);
    assert.equal(records()[1]!.data.result, 'save failed');
    assert.equal(records()[1]!.data.language, 'text');
});
