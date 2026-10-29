import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import * as profilesPlugin from './profile/plugin.js';
import * as integrationPlugin from './integration/plugin.js';
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
    await ctx.plugin(profilesPlugin);
    await ctx.plugin(integrationPlugin, { aliasesFile, defaultSearchMethod });
}

export { RuntimeHost } from './runtime/host.js';
export { SemanticRegistry } from './profile/catalog/registry.js';
export { PlaneProfile, PlaneProfileState } from './profile/plane/profile.js';
export type { PlaneProfileData, PlaneProfileStateData } from './profile/plane/profile.js';
export { toPlaneProfile } from './profile/plane/to_plane_profile.js';
export type { Intellisense } from './integration/intellisense.js';
export type { AgentSessionAddition } from './integration/agent_session_addition.js';
export { NamespaceComponent } from './profile/component.js';
export type { ManifestEntry, FunctionEntry, ProfileMember } from './profile/namespace/namespace.js';
export type { Node, NodeType, Permission, SerializedNode, FunctionContract, FunctionPresentation } from './profile/namespace/node.js';
export type { PhysicalTool, Mapping, Namespace, ProfileCatalogData, PinLevel, CommandVisibility } from './profile/catalog/registry.js';
export type { Profile, ProfileSnapshot, ProfileCollection, ProfileFactory, ProfileVersion } from './profile/profile.js';
export type { ProfileNode } from './profile/node.js';
export type { ProfileNamespace } from './profile/namespace.js';
export type { ProfileFunction } from './profile/function.js';
export { ToolAdditions } from './integration/tool_additions/tool_additions.js';
export type { ToolAddition } from './integration/tool_additions/tool_additions.js';
export { ProfileReference, SnapshotStore } from './profile/snapshot_store.js';
export type { ToolsNamespace, ProfileSaveEvent, ProfileSaveEffect, ProfileEditOptions } from './profile/service.js';
export type { ProfileData, Profiles, ToolBrief, CommandName } from './profile/catalog/profile_tree.js';
export type { CommandBinding, ExecutionResult } from './runtime/protocol.js';
export type { Store } from './storage/store.js';
export type { Saveable } from './storage/saveable.js';
export type { ToolDefinition } from '@deepseek-ai/dsh-tools';

export { SearchEngineRegistry } from './search/engine_registry.js';
export type { SearchEngine, SearchSelection, SearchDocument, SearchSelector, SearchField } from './search/engine_registry.js';

export { CommandStatistics } from './statistics/command_statistics.js';
export { Statistics } from './statistics/statistics.js';
export type { Counts, Counter } from './statistics/statistics.js';

export { profileWrite } from './profile/catalog/profile_write.js';
export type { ProfileWrite, ProfileRootWrite, ProfilePatch, FunctionWrite, NamespaceWrite } from './profile/catalog/profile_write.js';
export { ConversationRequiredError, ProfileLockedError, CurrentProfileDeletionError, UnknownCommandError, ZodError, normalizeError, ValidationError, ProfilePermissionError, ProfileNotFoundError, ToolCallError, PositionalArgumentError } from './error.js';
export type { ErrorData, ErrorIssue } from './error.js';

export { RootNamespace } from './tools/profile_nodes/root_namespace.js';
export { ImplToolsNamespace } from './tools/profile_nodes/impl_tools_namespace.js';
export { ImplToolsProfileNamespace } from './tools/profile_nodes/impl_tools_profile_namespace.js';
export { ImplToolsFunction } from './tools/profile_nodes/impl_tools_function.js';
export { ImplToolsInspectFunction } from './tools/profile_nodes/impl_tools_inspect_function.js';

export type { ToolCatalog } from './integration/tool_catalog.js';
export { applyProfile } from './profile/edit.js';
export { profilesPlugin as profilePlugin };
export type { ProfileSessionCollection } from './profile/session.js';
export type { PlaneProfileEditor, PlaneProfileEdit } from './profile/plane/editor.js';
