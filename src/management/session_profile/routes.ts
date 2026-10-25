import type { Context } from '@deepseek-ai/cordis';
import type { SemanticRegistry } from '../../registry/registry.js';
import type { NamespaceComponent } from '../../namespace/component.js';
import type { SessionProfileState } from './state.js';
import { z } from 'zod';

/** @brief Load a named namespace into one live session without changing the deployment default. */
export function registerSessionProfiles(ctx: Context, catalog: SemanticRegistry, namespaces: NamespaceComponent): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const selection = z.strictObject({ profile: z.string().min(1).max(80) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-profile', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            const session = new URL(request.url).searchParams.get('session');
            const agent = ctx.agents.list().find(agent => agent.id === session);
            if (!agent) return Response.json({ error: 'Session is not available' }, { status: 404, headers });
            if (!namespaces.enabled(agent)) {
                if (request.method === 'POST') return Response.json({ error: 'Session has no Intellisense presentation' }, { status: 400, headers });
                return Response.json({ enabled: false, profiles: [] } satisfies SessionProfileState, { headers });
            }
            if (request.method === 'POST') {
                if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected application/json' }, { status: 415, headers });
                const text = await request.text();
                if (text.length > 4096) return Response.json({ error: 'Request is too large' }, { status: 413, headers });
                const { profile } = selection.parse(JSON.parse(text));
                await namespaces.profiles.load(agent.id, profile);
                await namespaces.configurationChanged(agent);
            }
            const registry = await namespaces.registryFor(agent);
            return Response.json({ enabled: true, profile: registry.snapshot().profile, profiles: catalog.snapshot().profiles ?? [] } satisfies SessionProfileState, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
