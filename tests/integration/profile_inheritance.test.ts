import { NamespaceComponent } from '../../src/profile/component.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as presentation from '../../src/integration/presentation.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { ProfileSessions } from '../../src/profile/catalog/profiles.js';
import { SemanticRegistry } from '../../src/profile/catalog/registry.js';
import { MemoryStore } from '../../src/storage/store.js';
import { dshCompatibility } from '../../src/compatibility/compatibility.js';
import { version } from '../../src/compatibility/version.js';

test('host-compatible parent lookup inherits the parent working profile without changing new root defaults', async () => {
    const ctx = new Context();
    await ctx.plugin(SessionProjectionRegistry);
    const mounted = await ctx.plugin(AgentRegistry);
    const catalog = new SemanticRegistry(new MemoryStore());
    const profiles = new ProfileSessions(new NamespaceComponent(new Context(), catalog), new MemoryStore());
    const namespaces = new NamespaceIntegration(ctx, new NamespaceComponent(ctx, catalog), catalog, profiles);
    ctx.provide('tools', { schemas: () => [], setExecutor: () => {}, presentAs: () => () => {} } as unknown as Context['tools']);
    ctx.provide('namespaceIntegration', { register: () => {}, configureScope: async () => {} } as unknown as NamespaceIntegration);
    const scopes: ReturnType<typeof createScope>[] = [];
    const detach: (() => void)[] = [];

    /** @brief Publish runtime ownership on old hosts and explicit session lineage on new hosts. */
    async function agent(name: string, parent?: Agent, enabled = true, profile?: string, lineage: SessionId | null | undefined = parent?.id): Promise<Agent> {
        const id = SessionId(name);
        const value = { id, session: Session.create(id, [], { id, createdAt: Date.now(), ...(lineage == null ? {} : { parentSession: lineage }) }) } as Agent;
        const scope = createScope(ctx, value);
        scopes.push(scope);
        Object.assign(value, { ctx: scope.ctx });
        if (enabled) await scope.ctx.plugin(presentation, { mode: 'native', profile });
        const enter = ctx.agents.enter.bind(ctx.agents) as (agent: Agent, owner?: Agent) => () => void;
        detach.push(version.lt('0.2.2-rc.2', () => enter(value, parent)) ?? enter(value));
        return value;
    }

    try {
        await catalog.saveProfile('Work', { ...catalog.configuration(), namespaces: [{ path: 'saved', description: '', alwaysVisible: false }] });
        const parent = await agent('parent');
        await profiles.load(parent.session, 'Work');
        const parentPointer = (await namespaces.addition(parent)).profile.pointer;
        const restored = await agent('restored', undefined, true, undefined, parent.id);
        assert.equal(dshCompatibility.parentAgent(ctx, restored), version.gte('0.2.2-rc.2', () => parent));
        assert.equal((await namespaces.addition(restored)).name, version.gte('0.2.2-rc.2', () => 'Work') ?? 'Default');
        const runtimeOnly = await agent('runtime_only', parent, true, undefined, null);
        assert.equal(dshCompatibility.parentAgent(ctx, runtimeOnly), version.lt('0.2.2-rc.2', () => parent));
        assert.equal((await namespaces.addition(runtimeOnly)).name, version.lt('0.2.2-rc.2', () => 'Work') ?? 'Default');
        const orphan = await agent('orphan', undefined, true, undefined, SessionId('absent'));
        assert.equal(dshCompatibility.parentAgent(ctx, orphan), undefined);
        assert.equal((await namespaces.addition(orphan)).name, 'Default');
        await catalog.saveProfile('Work', { ...catalog.configuration('Work'), namespaces: [{ path: 'latest', description: 'Only catalog changed', alwaysVisible: true }] });
        const fixed = await agent('fixed', parent, true, 'Work');
        const fixedRegistry = await namespaces.addition(fixed);
        assert.equal(fixedRegistry.name, 'Work');
        assert.equal(fixedRegistry.profile.snapshot.resolve('latest')?.type, 'namespace');
        await profiles.load(fixed.session, 'Default');
        assert.equal((await namespaces.addition(fixed)).name, 'Work');
        const fixedRoot = await agent('fixed_root', undefined, true, 'Work');
        assert.equal((await namespaces.addition(fixedRoot)).name, 'Work');
        const missing = await agent('missing', undefined, true, 'Missing');
        await assert.rejects(namespaces.addition(missing), /Profile does not exist/);
        const child = await agent('child', parent);
        assert.equal(dshCompatibility.parentAgent(ctx, child), parent);
        const childRegistry = await namespaces.addition(child);
        await namespaces.configure(child);
        assert.equal(childRegistry.name, 'Work');
        assert.equal(childRegistry.profile.pointer, parentPointer);
        assert.deepEqual((await profiles.addition(child.session)).profile.serialize(), (await profiles.addition(parent.session)).profile.serialize());
        await profiles.load(parent.session, 'Default');
        assert.equal((await namespaces.addition(child)).name, 'Work');
        const grandchild = await agent('grandchild', child);
        await namespaces.addition(grandchild);
        assert.deepEqual((await profiles.addition(grandchild.session)).profile.serialize(), (await profiles.addition(child.session)).profile.serialize());
        const root = await agent('root');
        assert.equal(dshCompatibility.parentAgent(ctx, root), undefined);
        assert.equal((await namespaces.addition(root)).name, 'Default');
        const standard = await agent('standard', undefined, false);
        await profiles.load(standard.session, 'Work');
        const standalone = await agent('standalone', standard);
        assert.equal((await namespaces.addition(standalone)).name, 'Default');
        assert.equal(catalog.configuration('Work').namespaces[0]?.path, 'latest');
        const departed = await agent('departed');
        detach.at(-1)!();
        const survivor = await agent('survivor', undefined, true, undefined, departed.id);
        assert.equal(dshCompatibility.parentAgent(ctx, survivor), undefined);
        assert.equal((await namespaces.addition(survivor)).name, 'Default');
    } finally {
        for (const remove of detach.reverse()) remove();
        for (const scope of scopes.reverse()) await scope.dispose();
        await mounted.dispose();
    }
});
