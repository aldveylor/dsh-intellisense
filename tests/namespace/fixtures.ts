import { pluginCommands } from '../../src/runtime/builtins.js';
import { NamespaceIntegration } from '../../src/integration/namespace_integration.js';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { commandEntries, bindingFor, declaration, profileMembers, nativeArgumentsFor, serializeProfile, type ManifestEntry, type CommandEntry } from '../../src/namespace/namespace.js';
import { inspect as renderInspect } from '../../src/tools/inspect.js';
import { nativeDiscovery as renderNative, nativeQueryEntries as selectNative } from '../../src/namespace/native_tools.js';
import { profileTree } from '../../src/registry/profile_tree.js';
import { RootNamespace } from '../../src/tools/profile_nodes/root_namespace.js';
import { EditableNamespace, type ProfileNamespace } from '../../src/registry/profile/namespace.js';
import { EditableCommand } from '../../src/registry/profile/command.js';
import type { ProfileSnapshot } from '../../src/registry/profile/profile.js';
import type { SemanticRegistry, PhysicalTool } from '../../src/registry/registry.js';
import { ToolAdditions } from '../../src/integration/tool_additions/tool_additions.js';
import { RuntimeHost } from '../../src/runtime/host.js';

/** @brief Test conveniences over actual Profile nodes and flat contracts, with no shadow node graph. */
export function profileFixture(profile: ProfileSnapshot, tools: PhysicalTool[], mode: 'native' | 'ptc' = 'ptc', additions = new ToolAdditions()) {
    const entries = commandEntries(profile, tools, mode, additions).map(entry => Object.assign(entry, {
        binding: () => bindingFor(entry), declaration: (nested = true) => declaration(entry, nested),
        serialize: () => ({ description: entry.doc }),
    }));
    return { profile, entries, commands: () => entries,
        resolve: (parts: readonly string[]) => entries.find(entry => entry.path === parts.join('.')) ?? profile.resolve(parts.join('.')),
        serialize: () => serializeProfile(profile, tools, mode, additions) };
}

/** @brief Construct a Profile fixture from native physical tool contracts. */
export function namespace(entries: readonly ManifestEntry[] = []) {
    const profile = new RootNamespace();
    for (const entry of entries) {
        const parts = entry.path.split('.');
        let parent: ProfileNamespace = profile;
        for (const name of parts.slice(0, -1)) parent = parent.getOrCreate(name, () => new EditableNamespace()) as ProfileNamespace;
        if (!parent.children.has(parts.at(-1)!)) parent.create(parts.at(-1)!, () => new EditableCommand()).setTool(entry.tool);
    }
    return profileFixture(profile, entries.map(entry => ({ id: entry.tool, description: entry.doc, parameters: entry.schema, output: entry.output })));
}

/** @brief Exercise global editor conversion independently from session runtime state. */
export function manifest(registry: SemanticRegistry, aliases: readonly { path: string; tool: string }[] = [], mode: 'native' | 'ptc' = 'ptc') {
    const profile = registry.definitions.profile(profileTree(registry.profileSelection().selected, registry.configuration(), registry.definitions).save());
    const mounted = new Set([...profileMembers(profile)].filter(({ node }) => node.type === 'command').map(({ node }) => (node as import('../../src/registry/profile/command.js').ProfileCommand).tool));
    for (const alias of aliases) {
        if (!mounted.has(alias.tool)) continue;
        if (!registry.tools().some(tool => tool.id === alias.tool)) continue;
        const parts = alias.path.split('.');
        let parent: ProfileNamespace = profile;
        for (const name of parts.slice(0, -1)) parent = parent.getOrCreate(name, () => new EditableNamespace()) as ProfileNamespace;
        if (!parent.children.has(parts.at(-1)!)) parent.create(parts.at(-1)!, () => new EditableCommand()).setTool(alias.tool);
    }
    return profileFixture(profile, registry.tools(), mode, registry.toolAdditions);
}

/** @brief Render real Profile discovery using concise fixture arguments. */
export function inspect(queries: readonly string[], fixture: ReturnType<typeof profileFixture>, runtime = false): string { return renderInspect(queries, fixture.profile, fixture.entries, runtime); }

/** @brief Render real native discovery from the fixture's original Profile. */
export function nativeDiscovery(queries: readonly string[], fixture: ReturnType<typeof profileFixture>): string { return renderNative(queries, fixture.profile, fixture.entries); }

/** @brief Select real native contracts from original Profile query results. */
export function nativeQueryEntries(queries: readonly string[], fixture: ReturnType<typeof profileFixture>) { return selectNative(queries, fixture.profile, fixture.entries); }

/** @brief Exercise positional conversion in the real guest and native validation at dispatch. */
export async function positionalArguments(entry: ManifestEntry, args: unknown[]): Promise<unknown> {
    const command = namespace([entry]).entries.find(command => command.path === entry.path)!;
    const host = new RuntimeHost({ timeoutMs: 3000 });
    let received: unknown;
    try {
        const source = args.map(arg => arg === undefined ? 'undefined' : JSON.stringify(arg)).join(',');
        const result = await host.execute('arguments', 'call', `await ${entry.path}(${source});`, [bindingFor(command)], async (_tool, input) => {
            received = nativeArgumentsFor(entry, input);
            return null;
        }, new AbortController().signal);
        if (result.error) throw new Error(result.error);
        return received;
    } finally { await host.dispose(); }
}

/** @brief Prepare transport fixtures directly from a Profile, including unavailable builtin contracts when requested. */
export function createNamespace(context: { tools: PhysicalTool[]; includeUnavailable?: boolean; mode?: 'native' | 'ptc' }) {
    const profile = new RootNamespace();
    const tools = [...context.tools];
    if (context.includeUnavailable) {
        for (const command of pluginCommands.builtinTools) if (!tools.some(tool => tool.id === command.tool)) tools.push({ id: command.tool, description: '', parameters: {}, output: {} });
    }
    const fixture = profileFixture(profile, tools, context.mode);
    const children = new Map((fixture.serialize().children ?? []).map(node => [node.name, { serialize: () => node }]));
    return { ...fixture, children };
}

/** @brief Invoke prompt generation against the original global Profile fixture. */
export async function promptFor(registry: SemanticRegistry, mode: 'native' | 'ptc' = 'ptc'): Promise<string> {
    const fixture = manifest(registry, [], mode);
    return NamespaceIntegration.prototype.prompt.call({ isPtc: () => mode === 'ptc', get: async () => fixture.profile, entries: async () => fixture.entries } as unknown as NamespaceIntegration, {} as Agent);
}
