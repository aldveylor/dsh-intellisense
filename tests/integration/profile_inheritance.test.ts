import { NamespaceComponent } from '../../src/namespace/component.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as presentation from '../../src/integration/presentation.js';
import { AgentSessionAddition } from '../../src/integration/agent_session_addition.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/storage/store.js';

test('runtime child ownership inherits the nearest parent working profile without changing new root defaults', async () => {
    const ctx = new Context();
    const mounted = await ctx.plugin(AgentRegistry);
    const catalog = new SemanticRegistry(new MemoryStore());
    const profiles = new ProfileSessions(catalog, new MemoryStore());
    const namespaces = new AgentSessionAddition(ctx, new NamespaceComponent(ctx, catalog, []), profiles);
    ctx.provide('tools', { schemas: () => [], presentAs: () => {} } as unknown as Context['tools']);
    ctx.provide('agentSessionAddition', { register: () => {} } as unknown as AgentSessionAddition);
    const scopes: ReturnType<typeof createScope>[] = [];
    const detach: (() => void)[] = [];

    /** @brief Publish a real registry ownership relation separately from durable session lineage. */
    async function agent(name: string, parent?: Agent, enabled = true, profile?: string): Promise<Agent> {
        const id = SessionId(name);
        const value = { id, session: Session.create(id) } as Agent;
        const scope = createScope(ctx, value);
        scopes.push(scope);
        Object.assign(value, { ctx: scope.ctx });
        if (enabled) await scope.ctx.plugin(presentation, { mode: 'native', profile });
        detach.push(ctx.agents.enter(value, parent));
        return value;
    }

    try {
        await catalog.saveProfile('Work', { ...catalog.configuration(), namespaces: [{ path: 'saved', description: '', alwaysVisible: false }] });
        const parent = await agent('parent');
        await profiles.load(parent.id, 'Work');
        const parentRegistry = await namespaces.registryFor(parent);
        await parentRegistry.replaceConfiguration({ ...parentRegistry.configuration(), namespaces: [{ path: 'draft', description: 'Not saved to catalog', alwaysVisible: true }] }, 'Work');
        const fixed = await agent('fixed', parent, true, 'Work');
        const fixedRegistry = await namespaces.registryFor(fixed);
        assert.equal(fixedRegistry.snapshot().profile, 'Work');
        assert.equal(fixedRegistry.configuration().namespaces[0]?.path, 'saved');
        await profiles.load(fixed.id, 'Default');
        assert.equal((await namespaces.registryFor(fixed)).snapshot().profile, 'Work');
        const fixedRoot = await agent('fixed_root', undefined, true, 'Work');
        assert.equal((await namespaces.registryFor(fixedRoot)).snapshot().profile, 'Work');
        const missing = await agent('missing', undefined, true, 'Missing');
        await assert.rejects(namespaces.registryFor(missing), /Profile does not exist/);
        const child = await agent('child', parent);
        const childRegistry = await namespaces.registryFor(child);
        assert.equal(childRegistry.snapshot().profile, 'Work');
        assert.deepEqual(childRegistry.configuration(), parentRegistry.configuration());
        await profiles.load(parent.id, 'Default');
        assert.equal((await namespaces.registryFor(child)).snapshot().profile, 'Work');
        const grandchild = await agent('grandchild', child);
        assert.deepEqual((await namespaces.registryFor(grandchild)).configuration(), childRegistry.configuration());
        const root = await agent('root');
        assert.equal((await namespaces.registryFor(root)).snapshot().profile, 'Default');
        const standard = await agent('standard', undefined, false);
        await profiles.load(standard.id, 'Work');
        const standalone = await agent('standalone', standard);
        assert.equal((await namespaces.registryFor(standalone)).snapshot().profile, 'Default');
        assert.equal(catalog.configuration('Work').namespaces[0]?.path, 'saved');
    } finally {
        for (const remove of detach.reverse()) remove();
        await profiles.dispose();
        for (const scope of scopes.reverse()) await scope.dispose();
        await mounted.dispose();
    }
});
