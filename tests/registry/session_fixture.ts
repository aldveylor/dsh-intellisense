import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { ProfileSessionCollection } from '../../src/profile/session.js';

const sessions = new WeakMap<ProfileSessionCollection, Map<string, Session>>();

/** @brief Keep stable live sessions per test owner while allowing independent restored instances. */
export function sessionFor(owner: ProfileSessionCollection, id: string): Session {
    let live = sessions.get(owner);
    if (!live) sessions.set(owner, live = new Map());
    let session = live.get(id);
    if (!session) live.set(id, session = Session.create(SessionId(id)));
    return session;
}

/** @brief Configure a test session through its real snapshot publication API. */
export async function configureSession(namespaces: import('../../src/integration/namespace_integration.js').NamespaceIntegration, agent: import('@deepseek-ai/dsh-agent').Agent, mappings: readonly import('../../src/profile/catalog/registry.js').Mapping[]): Promise<void> {
    const { EditableNamespace } = await import('../../src/profile/namespace.js');
    const { EditableFunction } = await import('../../src/profile/function.js');
    const addition = await namespaces.addition(agent);
    const snapshot = addition.profile.snapshot;
    for (const mapping of mappings) {
        const parts = mapping.path.split('.');
        let parent: import('../../src/profile/namespace.js').ProfileNamespace = snapshot;
        for (const name of parts.slice(0, -1)) parent = parent.getOrCreate(name, () => new EditableNamespace()) as import('../../src/profile/namespace.js').ProfileNamespace;
        const command = parent.getOrCreate(parts.at(-1)!, () => new EditableFunction()) as import('../../src/profile/function.js').ProfileFunction;
        command.setTool(mapping.id);
        if (mapping.description !== undefined) command.setDescription(mapping.description);
        if (mapping.alwaysVisible !== undefined) command.setFixedLevel(mapping.alwaysVisible);
        if (mapping.disabled !== undefined) command.setDisabled(mapping.disabled);
    }
    await publishSessionFixture(namespaces, agent, snapshot);
}

/** @brief Publish a test setup globally and explicitly switch its session to the new version. */
export async function publishSessionFixture(namespaces: import('../../src/integration/namespace_integration.js').NamespaceIntegration, agent: import('@deepseek-ai/dsh-agent').Agent, snapshot: import('../../src/profile/profile.js').ProfileSnapshot): Promise<void> {
    const addition = await namespaces.addition(agent);
    await namespaces.namespace.edit(addition.name, () => snapshot);
    await namespaces.profiles.load(agent.session, addition.name);
    await namespaces.configurationChanged(agent);
}
