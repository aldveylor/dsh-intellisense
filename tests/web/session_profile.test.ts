import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import type { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import { registerSessionProfiles } from '../../src/web/session_profile/routes.js';
import { SemanticRegistry } from '../../src/registry/registry.js';
import { ProfileSessions } from '../../src/registry/profiles.js';
import { MemoryStore } from '../../src/storage/store.js';

/** @brief Exercise session selections against real independent Profile registries. */
async function fixture(locked = false) {
    const catalog = new SemanticRegistry(new MemoryStore());
    await catalog.load();
    await catalog.saveProfile('Files', { ...catalog.configuration(), brief: 'File operations', namespaces: [{ path: 'files', description: 'File tools', alwaysVisible: true }] });
    const profiles = new ProfileSessions(catalog, new MemoryStore());
    const agents = [{ id: 'native', enabled: true }, { id: 'ptc', enabled: true }, { id: 'standard', enabled: false }];
    const changed: string[] = [];
    let fetch!: (request: Request) => Promise<Response>;
    const ctx = { agents: { list: () => agents }, connection: { fetch: { register: (route: { fetch: typeof fetch }) => { fetch = route.fetch; } } } } as unknown as Context;
    const namespaces = {
        fixedProfile: () => locked ? 'Files' : undefined, profiles, enabled: (agent: typeof agents[number]) => agent.enabled,
        registryFor: (agent: typeof agents[number]) => profiles.forSession(agent.id),
        configurationChanged: async (agent: typeof agents[number]) => { changed.push(agent.id); },
    } as unknown as NamespaceIntegration;
    registerSessionProfiles(ctx, catalog, namespaces);
    return { catalog, profiles, changed, fetch, request: (session: string, body?: unknown, contentType = 'application/json') => fetch(new Request(`https://localhost/api/ts-intellisense-profile?session=${session}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify(body) })) };
}

test('profile selector loads native and PTC session namespaces independently from the catalog default', async () => {
    const { catalog, profiles, changed, request } = await fixture();
    const original = catalog.snapshot();
    await profiles.forSession('ptc');
    const response = await request('native', { profile: 'Files' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: true, profile: 'Files', profiles: ['Default', 'Files'], profileBriefs: { Files: 'File operations' } });
    assert.equal((await profiles.forSession('native')).configuration().namespaces[0]?.path, 'files');
    assert.equal((await profiles.forSession('ptc')).snapshot().profile, 'Default');
    assert.deepEqual(catalog.snapshot(), original);
    assert.deepEqual(changed, ['native']);
    assert.equal((await request('ptc', { profile: 'Files' })).status, 200);
    assert.equal((await profiles.forSession('ptc')).snapshot().profile, 'Files');
    assert.equal((await request('native', { profile: 'Default' })).status, 200);
    assert.equal((await profiles.forSession('native')).configuration().namespaces.length, 0);
});

test('profile selector hides for other presets and refuses invalid session or profile selections', async () => {
    const { profiles, changed, request } = await fixture();
    assert.deepEqual(await (await request('standard')).json(), { enabled: false, profiles: [] });
    assert.equal((await request('standard', { profile: 'Files' })).status, 400);
    assert.equal((await request('missing')).status, 404);
    assert.equal((await request('native', { profile: 'Missing' })).status, 400);
    assert.equal((await request('native', { profile: 'Files', activate: true })).status, 400);
    assert.equal((await request('native', { profile: 'Files' }, 'text/plain')).status, 415);
    assert.equal((await profiles.forSession('native')).snapshot().profile, 'Default');
    assert.deepEqual(changed, []);
});

test('new conversations capture the configured default rather than the previous conversation selection', async () => {
    const { catalog, profiles, request } = await fixture();
    await request('native', { profile: 'Files' });
    assert.equal((await profiles.forSession('new_before_default_change')).snapshot().profile, 'Default');
    await catalog.manageProfile('select', 'Files', catalog.snapshot().revision);
    await request('ptc', { profile: 'Default' });
    const created = await profiles.forSession('new_after_default_change');
    assert.equal(created.snapshot().profile, 'Files');
    assert.equal(created.configuration().namespaces[0]?.path, 'files');
    assert.equal((await profiles.forSession('ptc')).snapshot().profile, 'Default');
    assert.equal((await profiles.forSession('new_before_default_change')).snapshot().profile, 'Default');
});


test('a fixed presentation Profile remains visible and rejects session selector writes', async () => {
    const { profiles, changed, request } = await fixture(true);
    await profiles.load('native', 'Files');
    const response = await request('native');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).locked, true);
    assert.equal((await request('native', { profile: 'Default' })).status, 403);
    assert.equal((await profiles.forSession('native')).snapshot().profile, 'Files');
    assert.deepEqual(changed, []);
});

test('invalid session Profile requests return localized keys without changing the session', async () => {
    const { profiles, changed, fetch } = await fixture();
    for (const [body, key] of [
        ['{', 'invalid_json_body'],
        ['null', 'invalid_session_profile_request'],
        ['{}', 'invalid_session_profile_request'],
        ['{"profile":""}', 'invalid_session_profile_request'],
        ['{"profile":"Files","activate":true}', 'invalid_session_profile_request'],
    ]) {
        const response = await fetch(new Request('https://localhost/api/ts-intellisense-profile?session=native', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: key });
    }
    assert.equal((await profiles.forSession('native')).snapshot().profile, 'Default');
    assert.deepEqual(changed, []);
});
