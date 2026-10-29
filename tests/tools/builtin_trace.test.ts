import { NamespaceComponent } from '../../src/profile/component.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { registerToolCommands } from '../../src/tools/tool_commands.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { profileAnnotation } from '../../src/profile/catalog/profile_tree.js';
import { ProfileWriteSchema } from '../../src/profile/catalog/profile_write.js';
import { MemoryStore } from '../../src/storage/store.js';
import { registerBuiltin } from '../../src/tools/builtin_trace.js';

test('builtin recording captures the actual contract and preserves canonical results and failures', async () => {
    let registered: ToolDefinition | undefined;
    const session = Session.create(SessionId('builtin-trace'));
    const records = (): { type: string; data: Record<string, unknown> }[] => session.snapshotEvents() as unknown as { type: string; data: Record<string, unknown> }[];
    const ctx = { tools: { register: (definition: ToolDefinition) => { registered = definition; return () => {}; } } } as unknown as Context;
    const execution = { callId: 'call-1', agent: { ctx: { get: () => ({ isPtc: () => true }) }, session } } as unknown as ToolRunContext;
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

for (const ptc of [false, true]) test(`builtin discovery and Profile annotation support uninjected caller contexts in ${ptc ? 'ptc' : 'native'} mode`, async () => {
    const ctx = new Context();
    const definitions = new Map<string, ToolDefinition>();
    const session = Session.create(SessionId(`builtin-injection-${ptc}`));
    const catalog = new SemanticRegistry(new MemoryStore());
    const provider = await ctx.plugin({ apply: (scope: Context) => {
        scope.provide('namespaceIntegration', { isPtc: () => ptc } as unknown as NamespaceIntegration);
    } });
    ctx.provide('tools', { register: (definition: ToolDefinition) => {
        definitions.set(definition.name, definition);
        return () => { definitions.delete(definition.name); };
    } } as unknown as Context['tools']);
    let caller: Context;
    const mounted = await ctx.plugin({
        inject: ['tools'],
        apply: (scope: Context) => {
            caller = scope;
            registerBuiltin(scope, defineTool({
                name: 'tools_inspect', description: 'Discover commands', parameters: {},
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
                execute: async () => 'discovered commands',
            }));
            registerToolCommands(scope, new NamespaceComponent(scope, catalog), new ProfileSessions(new NamespaceComponent(new Context(), catalog), new MemoryStore()), async () => {}, async () => []);
        },
    });
    try {
        assert.throws(() => caller.namespaceIntegration, /without inject/);
        const execution = { callId: 'call-1', agent: { ctx: caller!, session }, signal: new AbortController().signal } as unknown as ToolRunContext;
        assert.equal(await definitions.get('tools_inspect')!.execute({}, execution), 'discovered commands');
        assert.equal(await definitions.get('tools_profile_annotation')!.execute({}, execution), ptc ? profileAnnotation : JSON.stringify(ProfileWriteSchema.toJSONSchema()));
        const records = session.snapshotEvents() as unknown as { type: string; data: Record<string, unknown> }[];
        assert.equal(records.length, 2);
        for (const record of records) {
            assert.equal(record.type, 'plugin:ts_intellisense/builtin');
            assert.equal(record.data.language, ptc ? 'typescript' : 'json');
            assert.equal(record.data.isError, false);
        }
    } finally { await mounted.dispose(); await provider.dispose(); }
});
