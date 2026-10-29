import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { ProfileSessions } from '../../src/registry/profiles.js';

const sessions = new WeakMap<ProfileSessions, Map<string, Session>>();

/** @brief Keep stable live sessions per test owner while allowing independent restored instances. */
export function sessionFor(owner: ProfileSessions, id: string): Session {
    let live = sessions.get(owner);
    if (!live) sessions.set(owner, live = new Map());
    let session = live.get(id);
    if (!session) live.set(id, session = Session.create(SessionId(id)));
    return session;
}

/** @brief Configure a test session through its real snapshot publication API. */
export async function configureSession(namespaces: import('../../src/integration/namespace_integration.js').NamespaceIntegration, agent: import('@deepseek-ai/dsh-agent').Agent, mappings: readonly import('../../src/registry/registry.js').Mapping[]): Promise<void> {
    const { EditableNamespace } = await import('../../src/registry/profile/namespace.js');
    const { EditableCommand } = await import('../../src/registry/profile/command.js');
    const addition = await namespaces.addition(agent);
    const snapshot = addition.profile.snapshot;
    for (const mapping of mappings) {
        const parts = mapping.path.split('.');
        let parent: import('../../src/registry/profile/namespace.js').ProfileNamespace = snapshot;
        for (const name of parts.slice(0, -1)) parent = parent.getOrCreate(name, () => new EditableNamespace()) as import('../../src/registry/profile/namespace.js').ProfileNamespace;
        const command = parent.getOrCreate(parts.at(-1)!, () => new EditableCommand()) as import('../../src/registry/profile/command.js').ProfileCommand;
        command.setTool(mapping.id);
        if (mapping.description !== undefined) command.setDescription(mapping.description);
        if (mapping.alwaysVisible !== undefined) command.setFixedLevel(mapping.alwaysVisible);
        if (mapping.disabled !== undefined) command.setDisabled(mapping.disabled);
    }
    await publishSessionFixture(namespaces, agent, snapshot);
}

/** @brief Publish a test setup globally and explicitly switch its session to the new version. */
export async function publishSessionFixture(namespaces: import('../../src/integration/namespace_integration.js').NamespaceIntegration, agent: import('@deepseek-ai/dsh-agent').Agent, snapshot: import('../../src/registry/profile/profile.js').ProfileSnapshot): Promise<void> {
    const { editedConfiguration } = await import('../../src/registry/profile/configuration.js');
    const addition = await namespaces.addition(agent);
    const catalog = namespaces.namespace.registry;
    await catalog.saveProfile(addition.name, editedConfiguration({ name: addition.name, root: snapshot.serialize(), brief: snapshot.brief }, catalog.configuration(addition.name), catalog.definitions), { trusted: true });
    await namespaces.profiles.load(agent.session, addition.name);
    await namespaces.configurationChanged(agent);
}
