import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SemanticRegistry } from '../../registry/registry.js';
import { createNamespace } from '../../namespace/namespace.js';
import type { NamespaceComponent } from '../../namespace/component.js';
import '@deepseek-ai/dsh-client-connection';
import { managementHtml } from './page.js';

/** @brief Validate complete editor writes before any registry transaction or profile selection. */
const mapping = z.strictObject({ id: z.string().min(1), path: z.string().min(1), aliases: z.array(z.string()), description: z.string().optional(), pinned: z.boolean(), disabled: z.boolean().optional(), alwaysVisible: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional() });
const visibility = z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2)]));
const configuration = {
    activate: z.boolean().optional(),
    editingProfile: z.string().trim().min(1).max(80).optional(),
    revision: z.number().int().nonnegative(), mappings: z.array(mapping),
    namespaces: z.array(z.strictObject({ path: z.string(), description: z.string(), alwaysVisible: z.boolean(), disabled: z.boolean().optional() })),
    builtinDisabled: z.array(z.string()).optional(), order: z.array(z.string()), unmountedVisible: visibility, builtinVisible: visibility,
    namespaceVisible: z.record(z.string(), z.boolean()), toolComments: z.record(z.string(), z.string()),
};
const managementRequest = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('configure'), ...configuration }),
    z.strictObject({ action: z.literal('save_as'), profile: z.string().trim().min(1).max(80), ...configuration }),
    z.strictObject({ action: z.literal('profile'), revision: z.number().int().nonnegative(), operation: z.enum(['create', 'select', 'rename', 'delete']), name: z.string().min(1), newName: z.string().min(1).optional(), activate: z.boolean().optional() })
        .refine(body => body.operation !== 'rename' || body.newName !== undefined),
]);

/** @brief Register management UI and APIs behind DSH owner-peer authentication and Host/Origin policy. */
export function registerManagement(ctx: Context, globalRegistry: SemanticRegistry, adapter: Pick<NamespaceComponent, 'refresh'> & Partial<Pick<NamespaceComponent, 'statistics'>>): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    ctx.connection.fetch.register({ path: '/api/ts-intellisense', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(managementHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-client', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(await readFile(new URL('../standalone.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            await adapter.refresh();
            if (request.method === 'GET') {
                const registry = globalRegistry;
                const state = registry.snapshot();
                const profile = new URL(request.url).searchParams.get('profile') ?? state.profile!;
                return Response.json({ defaultProfile: state.profile, state: { ...state, ...registry.configuration(profile), profile }, tools: registry.tools(), callsByTool: (await adapter.statistics?.snapshot())?.callsByTool ?? {}, provided: [...createNamespace({ tools: registry.tools(), includeUnavailable: true }).children.values()].map(node => node.serialize()), effective: registry.effective() }, { headers });
            }
            if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected application/json' }, { status: 415, headers });
            const bodyText = await request.text();
            if (bodyText.length > 1_048_576) return Response.json({ error: 'Body exceeds 1 MiB' }, { status: 413, headers });
            let input: unknown;
            try { input = JSON.parse(bodyText); }
            catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers }); }
            const parsed = managementRequest.safeParse(input);
            if (!parsed.success) return Response.json({ error: 'Invalid management request' }, { status: 400, headers });
            const body = parsed.data;
            const registry = globalRegistry;
            if (body.action === 'profile') await registry.manageProfile(body.operation, body.name, body.revision, body.newName, body.activate);
            else await registry.configure(body.mappings, body.revision, body.namespaces, body.order, body.unmountedVisible, body.action === 'save_as' ? body.profile : undefined, body.toolComments, body.builtinVisible, body.namespaceVisible, body.editingProfile, body.activate, body.builtinDisabled);
            ctx.emit('system-prompt/change');
            return Response.json({ ok: true }, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
