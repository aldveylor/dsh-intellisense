import type { Context } from '@deepseek-ai/cordis';
import type { ToolsNamespace } from '../../profile/service.js';
import type { NamespaceIntegration } from '../../integration/namespace_integration.js';
import type { SessionProfileState } from './state.js';
import { z } from 'zod';

/** @brief Load a named namespace into one live session without changing the deployment default. */
export function registerSessionProfiles(ctx: Context, catalog: ToolsNamespace, namespaces: NamespaceIntegration): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const selection = z.strictObject({ profile: z.string().min(1).max(80) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-profile', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            const session = new URL(request.url).searchParams.get('session');
            const agent = ctx.agents.list().find(agent => agent.id === session);
            if (!agent) return Response.json({ error: 'session_unavailable' }, { status: 404, headers });
            if (!namespaces.enabled(agent)) {
                if (request.method === 'POST') return Response.json({ error: 'session_presentation_unavailable' }, { status: 400, headers });
                return Response.json({ enabled: false, profiles: [] } satisfies SessionProfileState, { headers });
            }
            const locked = namespaces.fixedProfile(agent) !== undefined;
            if (request.method === 'POST') {
                if (locked) return Response.json({ error: 'session_profile_locked' }, { status: 403, headers });
                if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'expected_json' }, { status: 415, headers });
                const text = await request.text();
                if (text.length > 4096) return Response.json({ error: 'session_request_too_large' }, { status: 413, headers });
                let input: unknown;
                try { input = JSON.parse(text); }
                catch { return Response.json({ error: 'invalid_json_body' }, { status: 400, headers }); }
                const parsed = selection.safeParse(input);
                if (!parsed.success) return Response.json({ error: 'invalid_session_profile_request' }, { status: 400, headers });
                const { profile } = parsed.data;
                await namespaces.profiles.load(agent.session, profile);
                await namespaces.configurationChanged(agent);
            }
            const addition = await namespaces.addition(agent);
            const names = await catalog.list();
            const briefs = await Promise.all(names.map(async name => [name, (await catalog.get(name))?.brief] as const));
            return Response.json({ enabled: true, ...(locked ? { locked } : {}), profile: addition.name, profiles: names, profileBriefs: Object.fromEntries(briefs.flatMap(([name, brief]) => brief === undefined ? [] : [[name, brief]])) } satisfies SessionProfileState, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
