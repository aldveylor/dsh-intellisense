import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { profileConfiguration } from '../profile_picker/profile_json.js';
import { returnTypeDeclaration } from './return_type.js';
import type { PhysicalTool, SemanticRegistry } from '../../registry/registry.js';
import { createNamespace } from '../../namespace/namespace.js';
import type { SerializedNode } from '../../namespace/node.js';
import type { NamespaceComponent } from '../../namespace/component.js';
import '@deepseek-ai/dsh-client-connection';
import { managementHtml } from './page.js';

/** @brief Validate complete editor writes before any registry transaction or profile selection. */
const configuration = {
    ...profileConfiguration,
    activate: z.boolean().optional(),
    editingProfile: z.string().trim().min(1).max(80).optional(),
    revision: z.number().int().nonnegative(),
};
const managementRequest = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('recover') }),
    z.strictObject({ action: z.literal('configure'), ...configuration }),
    z.strictObject({ action: z.literal('save_as'), profile: z.string().trim().min(1).max(80), ...configuration }),
    z.strictObject({ action: z.literal('profile'), revision: z.number().int().nonnegative(), operation: z.enum(['create', 'select', 'rename', 'delete']), name: z.string().min(1), newName: z.string().min(1).optional(), activate: z.boolean().optional() })
        .refine(body => body.operation !== 'rename' || body.newName !== undefined),
]);

/** @brief Register management UI and APIs behind DSH owner-peer authentication and Host/Origin policy. */
export function registerManagement(ctx: Context, globalRegistry: SemanticRegistry, adapter: Pick<NamespaceComponent, 'refresh'> & Partial<Pick<NamespaceComponent, 'statistics'>> & { recover?: () => Promise<void> }): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    let catalog: { generation: string; tools: PhysicalTool[]; provided: SerializedNode[] } | undefined;
    ctx.connection.fetch.register({ path: '/api/ts-intellisense', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(managementHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-client', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(await readFile(new URL('../standalone.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            if (request.method === 'GET') {
                await adapter.refresh();
                const registry = globalRegistry;
                const state = registry.snapshot();
                const statistics = await adapter.statistics?.snapshot();
                const profile = new URL(request.url).searchParams.get('profile') ?? state.profile!;
                if (catalog?.generation !== registry.generation) {
                    const tools = registry.tools();
                    catalog = {
                        generation: registry.generation,
                        tools: tools.map(tool => ({ ...tool, outputDeclaration: returnTypeDeclaration(tool.output) })),
                        provided: [...createNamespace({ tools, includeUnavailable: true }).children.values()].map(node => node.serialize()),
                    };
                }
                return Response.json({ defaultProfile: state.profile, profileBriefs: registry.profileBriefs(), state: { ...state, ...registry.configuration(profile), profile }, tools: catalog.tools, callsByTool: statistics?.callsByTool ?? {}, queriesByTool: statistics?.queriesByTool ?? {}, namespaceQueriesByPath: statistics?.namespaceQueriesByPath ?? {}, provided: catalog.provided, effective: registry.effective() }, { headers });
            }
            if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'expected_json' }, { status: 415, headers });
            const bodyText = await request.text();
            if (bodyText.length > 1_048_576) return Response.json({ error: 'management_body_too_large' }, { status: 413, headers });
            let input: unknown;
            try { input = JSON.parse(bodyText); }
            catch { return Response.json({ error: 'invalid_json_body' }, { status: 400, headers }); }
            const parsed = managementRequest.safeParse(input);
            if (!parsed.success) return Response.json({ error: 'invalid_management_request' }, { status: 400, headers });
            const body = parsed.data;
            const registry = globalRegistry;
            if (body.action === 'recover') {
                if (adapter.recover) await adapter.recover();
                else {
                    await registry.load(true);
                    await adapter.statistics?.load(true);
                }
            }
            else if (body.action === 'profile') await registry.manageProfile(body.operation, body.name, body.revision, body.newName, body.activate);
            else await registry.configure(body.mappings, body.revision, body.namespaces, body.order, body.unmountedVisible, body.action === 'save_as' ? body.profile : undefined, body.toolComments, body.builtinVisible, body.namespaceVisible, body.editingProfile, body.activate, body.builtinDisabled, body.brief);
            ctx.emit('system-prompt/change');
            const state = registry.snapshot();
            return Response.json({ ok: true, revision: state.revision, defaultProfile: state.profile, profiles: state.profiles, profileBriefs: registry.profileBriefs() }, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
