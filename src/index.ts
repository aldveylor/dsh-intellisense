import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import * as namespacePlugin from './namespace/plugin.js';
import { RuntimeConfig } from './runtime/host.js';

export const name = 'dsh-intellisense';
export const inject = ['tools', 'agents', 'systemPrompt', 'storage', storageBackendServiceKey('json'), 'connection'];
/** @brief Configure aliases and the isolated namespace execution backend. */
export const Config = RuntimeConfig.extend({ aliasesFile: z.string().optional(), defaultSearchMethod: z.string().regex(/^[a-z][a-z0-9_]*$/).optional() });
/** @brief Public plugin settings; each presentation selects its execution mode. */
export type Config = z.input<typeof Config>;

/** @brief Mount namespace discovery and scoped namespace execution without intercepting model streams. */
export async function apply(ctx: Context, options: Config = {}): Promise<void> {
    const { aliasesFile, defaultSearchMethod, ...runtimeOptions } = Config.parse(options);
    ctx.provide('codeRuntimeOptions', runtimeOptions);
    await ctx.plugin(namespacePlugin, { aliasesFile, defaultSearchMethod });
}

export { RuntimeHost } from './runtime/host.js';
export { SemanticRegistry, RegistryConfiguration, RegistryState } from './registry/registry.js';
export { NamespaceComponent } from './namespace/component.js';
export { NamespaceNode, CommandNode } from './namespace/namespace.js';
export type { NamespaceInitialization, NamespaceImplementation } from './namespace/nodes/context.js';
export type { ManifestEntry, NamespaceContext } from './namespace/namespace.js';
export type { Node, NodeType, Permission, SerializedNode, CommandContract, CommandPresentation } from './namespace/node.js';
export type { PhysicalTool, Mapping, Namespace, RegistryConfigurationData, RegistryStateData, PinLevel, CommandVisibility } from './registry/registry.js';
export type { Profile, ProfileSnapshot, ProfileCollection } from './registry/profile/profile.js';
export type { ProfileNode } from './registry/profile/node.js';
export type { ProfileNamespace } from './registry/profile/namespace.js';
export type { ProfileCommand } from './registry/profile/command.js';
export type { ToolAddition, ToolsNamespace, ProfileSaveEvent, ProfileSaveEffect } from './namespace/service.js';
export type { ProfileData, Profiles, CommandBrief, CommandName } from './registry/profile_tree.js';
export type { CommandBinding, ExecutionResult } from './runtime/protocol.js';
export type { Store } from './storage/store.js';
export type { Saveable } from './storage/saveable.js';
export type { ToolDefinition } from '@deepseek-ai/dsh-tools';

export { SearchEngineRegistry } from './search/engine_registry.js';
export type { SearchEngine, SearchSelection, SearchDocument, SearchSelector, SearchField } from './search/engine_registry.js';

export { CommandStatistics } from './namespace/statistics.js';
export type { CommandCounts, CommandStatisticsSnapshot, QueryTarget } from './namespace/statistics.js';

export { profileWrite } from './registry/profile_write.js';
export type { ProfileWrite, ProfileRootWrite, ProfilePatch, CommandWrite, NamespaceWrite } from './registry/profile_write.js';
export { ConversationRequiredError, ProfileLockedError, CurrentProfileDeletionError, UnknownCommandError, ZodError, normalizeError, ValidationError, ProfilePermissionError, ProfileNotFoundError, ToolCallError, PositionalArgumentError } from './error.js';
export type { ErrorData, ErrorIssue } from './error.js';
