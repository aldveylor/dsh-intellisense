# Development guide: agent presets and builtins

[简体中文](../zh-cn/development.md) · [Usage guide](usage.md)

This guide describes the plugin's agent preset configuration and builtin interfaces, based on the current repository implementation.

## Preset composition

The main component, `@aldveylor/dsh-intellisense`, provides namespace services, Profile management and runtime infrastructure. The separate `@aldveylor/dsh-intellisense/preset` component registers two presets:

| Directory | Preset ID | Name | `config.mode` |
| --- | --- | --- | --- |
| `presets/intellisense_ptc/` | `intellisense-ptc` | Intellisense PTC | `ptc` |
| `presets/intellisense/` | `intellisense` | Intellisense | `native` |

Each directory contains `preset.yml`, with string fields `id`, `name`, `description` and a numeric `order`; additional fields are rejected. Its `agent.cordis.yml` contains the complete agent plugin list, including tools, skills, planning, compaction and delegation. The registration component loads, validates and registers these declarations, releases registrations on disposal, and does not inject or rewrite presentation configuration.

[`cordis.patch.yml`](../../cordis.patch.yml) mounts both the main and preset registration components. It sets `agent-preset-registry.config.default` and `selectedDefault` to `intellisense-ptc`. Those settings belong to the preset registry; execution mode comes from each preset's presentation configuration.

## Presentation config

Add this entry to a custom preset's `agent.cordis.yml` plugin list:

```yaml
- id: intellisense-presentation
  name: '@aldveylor/dsh-intellisense/presentation'
  config:
    mode: ptc
    profile: coding
```

The main component and DSH tools service must already be mounted. Presentation requires an agent or preset scope. This example assumes that `coding` exists in the plugin's tool Profile catalog; remove the `profile` line to allow Profile selection.

| Field | Type | Required | Behavior |
| --- | --- | --- | --- |
| `mode` | `native` or `ptc` | No | Selects tool presentation, initial prompts and execution; defaults to `native` |
| `profile` | String, 1–80 characters | No | Fixes the conversation to a named tool Profile; no default |

The schema is strict and rejects unknown fields. The preset ID, plugin entry ID and `config.mode` are independent. Keep the builtin entry ID `intellisense-presentation` and select execution with `mode`. The plugin's modes apply to explicitly configured presentation scopes and their descendants. Loading the main component or preset registration component alone does not select a mode. Configuration lookup uses the nearest presentation in the scope chain. Omitting `mode` in that configuration selects `native`, even if an outer presentation uses `ptc`.

### `mode: native`

Uses native DSML calls without creating a conversation code runtime. The initial tool set includes enabled `tools.inspect` and commands fixed at level 2. Level 1 only exposes paths and summaries. Inspecting an exact command path adds that command to the conversation's callable set; listing namespace members does not mount all listed commands.

Native proxy names prepend `ns_` and replace dots with `__`: `tools.profile.load` becomes `ns_tools__profile__load`. Calls use named argument objects. Use the actual names exposed in the current tool list.

### `mode: ptc`

The model calls the plugin-owned `tools_run_code` transport to execute an async TypeScript/JavaScript function body. Code calls namespace functions with positional arguments. Child calls still pass through DSH's native execution pipeline for permissions and auditing. Presentation creates scoped runtime services without replacing the global `ptcRuntime`.

| `tools_run_code` argument | Meaning |
| --- | --- |
| `code: string`, required | Async function body; use `await` and an explicit `return` |
| `description: string`, required | Concise description of the program |
| `timeoutMs: number`, optional | Positive finite milliseconds; defaults to and is capped by the main component's `timeoutMs` |

Success returns `{ logs: string[], result?: JSON value }`. Console output goes into `logs`. Function-local declarations do not persist. Values attached to `globalThis` can survive within a conversation, but a VM restart loses that state.

```json
{
  "code": "return await tools.inspect(['tools.', 'tools.profile.load']);",
  "description": "Inspect builtin interfaces"
}
```

### Profile selection and locking

Here, Profile means the plugin's tool namespace configuration. It is separate from both a DSH launch profile and an agent preset.

- With `profile`: the conversation uses that catalog Profile. The home screen's Profile button remains visible but disabled. Both the UI selection API and `tools.profile.switch` reject switching (`session_profile_locked`). The named catalog entry must exist.
- Without `profile`: new root conversations capture the global default selected in the UI. A child agent initially inherits its parent's current working snapshot, including unsaved edits. Parent and child snapshots then remain independent.
- Catalog entries and conversation snapshots are separate. `load`, `save` and `apply` remain available with a fixed Profile, but publishing a catalog change does not refresh an existing conversation snapshot.

## Builtin interfaces

Names below are namespace paths. In PTC, invoke async functions directly. In native mode, call their proxies with named arguments. Only `tools.inspect` is fixed at level 2 by default; inspect other builtin paths to discover their complete interfaces. Disabled nodes and descendants leave discovery, prompts, bindings and preloaded values. `tools.inspect` can also be disabled.

### Discovery and search

```ts
await tools.inspect(['']);                      // Root namespace
await tools.inspect(['tools.', 'tools.profile.load']);
```

`inspect(queries: string[]): Promise<string>` lists immediate members for trailing-dot queries and complete contracts for exact command paths. An initial `global.` is ignored. PTC returns TypeScript declarations as a string. Native returns a JSON string and updates the callable tool set after exact command queries. Query available mount paths; physical tool names cannot be used for inspection.

Native example: `ns_tools__inspect` receives `{"queries":["tools.","tools.profile.load"]}`. The physical registration is `tools_inspect`; physical names and model-facing namespace proxy names belong to different layers.

`tools.search` returns `Promise<string[]>`: complete command paths ranked by relevance within the current effective tree. Unavailable and disabled paths are excluded. Search does not discover or mount commands; use `inspect` for details.

| Argument, in PTC positional order | Type and default |
| --- | --- |
| `keywords` | Required `string[]`; keywords match with OR |
| `method` | Optional registered search method; prefers `bm25`, falls back to `accurate` without the optional dependency |
| `max_results` | Optional nonnegative safe integer; `10` |
| `target` | Optional `name` / `description` / `parameters` / `all`; `all` |
| `namespace_path` | Optional namespace and descendants; `""` for the whole tree |

The main component's `defaultSearchMethod` changes the default. With only one registered engine, `method` is removed and subsequent PTC arguments shift left. Read the live signature with `inspect(['tools.search'])`. Empty keywords or `max_results: 0` produce an empty array.

### Profile management functions

| PTC call | Native arguments | Result and effect |
| --- | --- | --- |
| `load(name?)` | `{name?}` | `Promise<Profile>`; reads the conversation draft if omitted, otherwise reads the catalog; does not switch |
| `save(profile)` / `save(name, profile)` | `{name?, profile}` | `Promise<string \| null>`; replaces a catalog tree; an explicit name can create an entry; omitted name uses the conversation's selection |
| `apply(value)` / `apply(name, value)` | `{name?, value}` | `Promise<string \| null>`; reads, recursively patches and publishes; an explicit name must already exist |
| `switch(name)` | `{name}` | PTC `Promise<void>`, native `null`; replaces the conversation snapshot from the catalog and refreshes tools and prompts; rejected with a fixed Profile |
| `setdefault(name)` | `{name}` | PTC `Promise<void>`, native `null`; makes an existing entry the global default; preserves existing conversations |
| `remove(name)` | `{name}` | PTC `Promise<void>`, native `null`; deletes a catalog entry; requires a name and rejects the current conversation's selected Profile; other snapshots survive |

All functions belong to `tools.profile`. The two-argument PTC forms of `save` and `apply` also accept `undefined` as the first argument. Native proxies such as `ns_tools__profile__apply` use the argument names above. Its physical registration is `tools_profile_apply`; the other functions follow the same convention.

On success, `save` and `apply` return `null` without an advisory, or an advisory string if inspect is unavailable while enabled commands remain below fixed level 2. An advisory still means the write succeeded. Invalid input and permission violations throw. Both functions only publish to the catalog. Verify with `load(name)` and explicitly call `switch(name)` to apply the saved tree to the conversation.

### Profile data interfaces

| Interface | PTC | Native zero-argument call and result |
| --- | --- | --- |
| `tools.profile.profiles` | Readonly object | `profiles({})` → `{ profiles: string[], selected: string }` |
| `tools.profile.annotation` | Readonly string with TypeScript read/write model declarations | `annotation({})` → write-model JSON Schema string |
| `tools.profile.tools` | Readonly array | `tools({})` → `ToolBrief[]` |

The native column uses namespace shorthand: the actual call is, for example, `ns_tools__profile__profiles` with `{}`. In PTC these three members are preloaded values; do not call `profiles()`, `annotation()` or `tools()`. Values load before each execution; `profiles` also refreshes after successful tool calls.

`ToolBrief` is `{ name: string, brief: string, paths: string[], totalCalls: number }`. `name` is the physical tool name. The catalog excludes plugin builtins. `paths` describes mounts in the current conversation Profile, including disabled and currently unavailable paths, and is empty for unmounted tools. `totalCalls` counts calls across conversations. After saving, these paths do not describe the new catalog tree; verify that with `load(name)`.

### Write model and patches

`load` returns a Profile containing `name` and optional readonly `permissions`. `ProfileWrite` only accepts optional `brief` and `root`. It forbids `name` and recursively forbids `permissions`. The anonymous root only accepts `type: 'namespace'` and `children`. Host extensions can import `profileWrite(loaded)` from the package root to project loaded data into the write model. Models can read `tools.profile.annotation` for full declarations.

Ordinary namespace nodes accept `type: 'namespace'`, `description?`, `children?`, `fixedLevel?: 0 | 1` and `disabled?: boolean`. Command nodes accept `type: 'command'`, `command: { tool: string, doc?: string }`, `fixedLevel?: 0 | 1 | 2` and `disabled?: boolean`. Keys in `children` are member names. Fixed level 0 means unpinned, 1 means brief hints, and 2 means detailed hints and direct native registration.

A complete `save` must retain the protected `tools` subtree, including identities, paths and documentation. Omitted ordinary mounts are removed. In `save`, `tools` defaults to disabled; explicitly set `disabled: false` to keep it enabled.

`apply` accepts a recursive partial write model. Omitted fields retain their values, `children` merges by member name, arrays replace whole arrays, and `null` deletes optional fields or members. Required fields cannot be deleted. It preserves omitted disabled states rather than applying `save`'s default disabling of tools. To rename or move an ordinary mount, delete its old key and add the new key; adding alone retains both. The server always validates protected-node rules.

This PTC example changes an existing catalog entry's summary and explicitly applies it. It requires enabled management tools and a conversation without `config.profile` locking:

```ts
const name = tools.profile.profiles.selected;
const advisory = await tools.profile.apply(name, { brief: 'Coding tools' });
const saved = await tools.profile.load(name);
await tools.profile.switch(name);
return { advisory, saved };
```

## Checking configuration changes

1. Use the builtin `agent.cordis.yml` files as complete composition references. Retain the required tool plugins. Set `mode: ptc` for PTC, or omit `mode` to use the default `native` mode.
2. Try `profile` with an existing catalog entry and check locking. Without it, check default selection and parent-conversation inheritance.
3. In PTC, check discovery and preloaded fields through `tools_run_code`. In native, list namespace members, inspect an exact command, then call it.
4. Run relevant checks when changing builtin presets or TypeScript implementations. Documentation-only edits do not require a build or the full test suite.

Implementation: [`src/preset/index.ts`](../../src/preset/index.ts), [`src/integration/presentation.ts`](../../src/integration/presentation.ts), [`src/runtime/builtins.ts`](../../src/runtime/builtins.ts), [`src/tools/tool_commands.ts`](../../src/tools/tool_commands.ts).
