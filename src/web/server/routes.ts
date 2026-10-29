import type { Statistics } from '../../statistics/statistics.js';
import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { profileConfiguration } from '../profile/profile_json.js';
import { returnTypeDeclaration } from './return_type.js';
import type { PhysicalTool } from '../../profile/catalog/registry.js';
import type { ToolsNamespace } from '../../profile/service.js';
import type { ToolCatalog } from '../../integration/tool_catalog.js';
import { serializeProfile, profileMembers } from '../../profile/namespace/namespace.js';
import type { SerializedNode } from '../../profile/namespace/node.js';
import type { CommandStatistics } from '../../statistics/command_statistics.js';
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
export function registerManagement(ctx: Context, profiles: ToolsNamespace, adapter: { catalog: ToolCatalog; refresh: () => Promise<void>; statistics?: CommandStatistics; inspectStatistics?: Statistics; recover?: () => Promise<void> }): void {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    let catalog: { generation: string; tools: PhysicalTool[]; physical: PhysicalTool[]; provided: Map<string, SerializedNode[]> } | undefined;
    ctx.connection.fetch.register({ path: '/api/ts-intellisense', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(managementHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-client', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response(await readFile(new URL('../standalone.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } }) });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-docs-image', methods: ['GET'], requestBody: 'buffered', fetch: async request => {
        const query = new URL(request.url).searchParams;
        const result = z.strictObject({ language: z.enum(['en', 'zh']), name: z.enum(['namespace_table', 'profile_editor', 'namespace_tree', 'tools', 'tooltip', 'new_conversation']) }).safeParse(Object.fromEntries(query));
        if (!result.success) return new Response(null, { status: 404, headers });
        const { language, name } = result.data;
        try {
            return new Response(await readFile(new URL(`../../../assets/${language}/${name}.png`, import.meta.url)), { headers: { ...headers, 'Content-Type': 'image/png' } });
        } catch { return new Response(null, { status: 404, headers }); }
    } });
    ctx.connection.fetch.register({ path: '/api/ts-intellisense-state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
        try {
            if (request.method === 'GET') {
                await adapter.refresh();
                const editor = profiles.editor;
                const state = await editor.snapshot();
                const profile = new URL(request.url).searchParams.get('profile') ?? state.profile!;
                const callsByTool = await adapter.statistics?.calls.snapshot() ?? {};
                const queriesByTool = await adapter.statistics?.queries.snapshot() ?? {};
                const queriesByPath = await adapter.inspectStatistics?.snapshot(profile) ?? {};
                const generation = `${profiles.revision}:${adapter.catalog.generation}`;
                if (catalog?.generation !== generation) {
                    const owned = new Set([...profileMembers(profiles.createInitialProfile(), false)].filter(({ node }) => node.type === 'function' && !node.permissions.removable).map(({ node }) => (node as import('../../profile/function.js').ProfileFunction).tool));
                    const tools = adapter.catalog.tools().map(tool => ({ ...tool, provided: owned.has(tool.id) }));
                    catalog = {
                        generation,
                        tools: tools.map(tool => ({ ...tool, outputDeclaration: returnTypeDeclaration(tool.output) })),
                        physical: tools, provided: new Map(),
                    };
                }
                const selected = await editor.configuration(profile);
                let provided = catalog.provided.get(profile);
                if (!provided) {
                    provided = serializeProfile(await editor.provided(profile), catalog.physical, 'ptc', adapter.catalog.toolAdditions).children ?? [];
                    catalog.provided.set(profile, provided);
                }
                return Response.json({ defaultProfile: state.profile, profileBriefs: (await editor.briefs()), state: { ...state, ...selected, profile }, tools: catalog.tools, callsByTool, queriesByTool, queriesByPath, provided, effective: (await editor.effective(catalog.physical)) }, { headers });
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
            const editor = profiles.editor;
            if (body.action === 'recover') {
                if (adapter.recover) await adapter.recover();
                else {
                    await profiles.initialize(true);
                    await adapter.statistics?.load(true);
                    await adapter.inspectStatistics?.load(true);
                }
            }
            else if (body.action === 'profile') await editor.manageProfile(body.operation, body.name, body.revision, body.newName, body.activate);
            else await editor.configure({ ...body, profile: body.action === 'save_as' ? body.profile : undefined }, adapter.catalog.tools());
            ctx.emit('system-prompt/change');
            const state = await editor.snapshot();
            return Response.json({ ok: true, revision: state.revision, defaultProfile: state.profile, profiles: state.profiles, profileBriefs: (await editor.briefs()) }, { headers });
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers }); }
    } });
}
