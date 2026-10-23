import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import type { Namespace, Mapping, SemanticRegistry } from '../../registry/registry.js';
import type { TextPtcAdapter } from '../../integration/adapter.js';
import type { OrganizationService } from '../../integration/organization.js';
import '@deepseek-ai/dsh-client-connection';
import { managementHtml } from './page.js';

/** @brief Register management UI and APIs behind DSH owner-peer authentication and Host/Origin policy. */
export function registerManagement(ctx: Context, globalRegistry: SemanticRegistry, adapter: TextPtcAdapter, organization: OrganizationService): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    ctx.connection.fetch.register({ path: '/api/ts-intellisense', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(managementHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-client', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(await readFile(new URL('../standalone.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            adapter.refresh();
            const sessions = ctx.agents.list().filter(a => a.session.header.origin !== 'subagent');
            if (request.method === 'GET') {
                const registry = globalRegistry;
                return Response.json({ state: registry.snapshot(), tools: registry.tools(), effective: registry.effective(), declarations: registry.declarations(), sessions: sessions.map(a => ({ id: a.id })) }, { headers });
            }
            if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected application/json' }, { status: 415, headers });
            const bodyText = await request.text();
            if (bodyText.length > 1_048_576) return Response.json({ error: 'Body exceeds 1 MiB' }, { status: 413, headers });
            const body = JSON.parse(bodyText) as { action: string; mappings: Mapping[]; namespaces?: Namespace[]; order?: string[]; unmountedVisible?: string[]; builtinVisible?: string[]; revision: number; id: string; operation?: 'create' | 'select' | 'rename' | 'delete'; name?: string; newName?: string; profile?: string; toolComments?: Record<string, string> };
            const registry = globalRegistry;
            if (body.action === 'configure') await registry.configure(body.mappings, body.revision, body.namespaces, body.order, body.unmountedVisible, body.profile, body.toolComments, body.builtinVisible);
            else if (body.action === 'profile') await registry.manageProfile(body.operation!, body.name!, body.revision, body.newName);
            else if (body.action === 'organize') {
                const parent = sessions[0];
                if (!parent) throw new Error('Select a live conversation');
                return Response.json(await organization.propose(parent, request.signal, registry), { headers });
            } else if (body.action === 'approve') await organization.approve(body.id);
            else throw new Error('Unknown action');
            ctx.emit('system-prompt/change');
            return Response.json({ ok: true }, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
