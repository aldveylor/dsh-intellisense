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
