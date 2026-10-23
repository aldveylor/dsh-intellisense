import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PhysicalTool, SemanticRegistry } from '../registry/registry.js';
import type { ProfileSessions } from '../registry/profiles.js';
import { manifest, type Aliases, type ManifestEntry } from './namespace.js';
import { namespaceDirectory, type NamespaceHint } from './prompt.js';
import { builtinCommands, defaultBuiltinVisible } from '../runtime/builtins.js';
import type { z } from 'zod';

/** @brief Profile-backed namespace discovery, independent of any execution runtime. */
export class NamespaceComponent {
    constructor(private ctx: Context, private registry: SemanticRegistry, readonly profiles: ProfileSessions, private aliases: z.infer<typeof Aliases>) {}

    /** @brief Read only the native tool catalog visible to this agent. */
    physical(agent?: Agent): PhysicalTool[] {
        const tools = agent?.ctx.tools ?? this.ctx.tools;
        return tools.schemas(agent).filter(tool => !['exec', 'run_code'].includes(tool.name)).map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, output: tools.get(tool.name, agent)!.output.schema }));
    }

    /** @brief Refresh global metadata without changing any Profile configuration. */
    refresh(): void {
        const tools = new Map(this.physical().map(tool => [tool.id, tool]));
        for (const agent of this.ctx.agents.list()) for (const tool of this.physical(agent)) tools.set(tool.id, tool);
        this.registry.refresh([...tools.values()]);
    }

    /** @brief Resolve the session's immutable Profile reference against its current tool scope. */
    async registryFor(agent?: Agent): Promise<SemanticRegistry> {
        this.refresh();
        if (!agent) return this.registry;
        const registry = await this.profiles.forSession(agent.id);
        registry.refresh(this.physical(agent));
        return registry;
    }

    /** @brief Resolve the current enabled namespace independently of prompt visibility. */
    async entries(agent: Agent): Promise<ManifestEntry[]> { return manifest(await this.registryFor(agent), this.aliases); }

    /** @brief Notify the native system-prompt assembler after session configuration changes. */
    async configurationChanged(agent: Agent): Promise<void> { await this.registryFor(agent); this.ctx.emit('system-prompt/change'); }

    /** @brief Publish only explicitly pinned commands and namespaces with their Profile briefs. */
    async prompt(agent: Agent): Promise<string> {
        const registry = await this.registryFor(agent);
        const state = registry.snapshot();
        const entries = manifest(registry, this.aliases);
        const hints: NamespaceHint[] = [];
        for (const entry of entries) {
            const mapping = registry.effective().find(mapping => mapping.id === entry.tool);
            if (mapping?.alwaysVisible) hints.push({ path: entry.path, description: state.toolComments?.[entry.tool] ?? mapping.description ?? entry.doc });
        }
        for (const item of state.namespaces ?? []) if (item.alwaysVisible && entries.some(entry => entry.path.startsWith(item.path + '.'))) hints.push({ ...item, namespace: true });
        for (const item of builtinCommands) if ((state.builtinVisible ?? defaultBuiltinVisible).includes(item.path)) hints.push(item);
        return namespaceDirectory(hints);
    }

    /** @brief Release a live Profile reference while retaining its persisted version. */
    release(owner: string): void { this.profiles.release(owner); }
}
