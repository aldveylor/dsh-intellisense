import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import type { Mapping, SemanticRegistry } from '../registry/registry.js';
import type { TypeScriptAdapter } from '../dsh/adapter.js';
import type { OrganizationService } from '../dsh/organization.js';
import { SessionId } from '@deepseek-ai/dsh-session';
import '@deepseek-ai/dsh-client-connection';
import { managementHtml } from './ui.js';

/** @brief Register management UI and APIs behind DSH owner-peer authentication and Host/Origin policy. */
export function registerManagement(ctx: Context, registry: SemanticRegistry, adapter: TypeScriptAdapter, organization: OrganizationService): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    ctx.connection.fetch.register({ path: '/api/ts-intellisense', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(managementHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-client', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(await readFile(new URL('./client.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            adapter.refresh();
            if (request.method === 'GET') return Response.json({ state: registry.snapshot(), tools: registry.tools(), effective: registry.effective(), declarations: registry.declarations(), sessions: ctx.agents.list().filter(a => a.options.provider === adapter.config.route).map(a => ({ id: a.id })) }, { headers });
            if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected application/json' }, { status: 415, headers });
            const bodyText = await request.text();
            if (bodyText.length > 1_048_576) return Response.json({ error: 'Body exceeds 1 MiB' }, { status: 413, headers });
            const body = JSON.parse(bodyText) as { action: string; mappings: Mapping[]; revision: number; sessionId: string; id: string };
            if (body.action === 'configure') await registry.configure(body.mappings, body.revision);
            else if (body.action === 'organize') {
                const parent = ctx.agents.get(SessionId(body.sessionId));
                if (!parent || parent.options.provider !== adapter.config.route) throw new Error('Select a live TypeScript session');
                return Response.json(await organization.propose(parent, request.signal), { headers });
            } else if (body.action === 'approve') await organization.approve(body.id);
            else throw new Error('Unknown action');
            ctx.emit('system-prompt/change');
            return Response.json({ ok: true }, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
