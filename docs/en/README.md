# dsh-intellisense

[简体中文](../zh/README.md) | [Project home](../../README.md)

Shared profiles, namespace-based tool calls, and on-demand TypeScript signatures for DeepSeek Harness.

Both Agent Modes use the same namespace configuration:

- **Intellisense PTC** (`intellisense-ptc`): execute TS/JS through the plugin-owned `tools_run_code` and call commands such as `std.cwd()` and `std.fs.read(...)` from code.
- **Intellisense** (`intellisense`): call namespace tools such as `std.cwd`, `std.fs.read`, and `tools.intellisense` directly through native DSML.

## Getting started

Requires Node.js >=24. The runtime uses Node.js native permissions (`--permission`); Python and libseccomp are not required. Node.js 24 permissions do not restrict network access. Isolation requirements are checked when the runtime loads.

Run these commands from the project root:

```sh
npm ci
./run.sh
```

`run.mjs` builds the package and registers it in the Web profile as a native bundle. It supports `--plugin <directory>`. The default workspace is `build/workspace`; configuration and data are stored in `build/.dsh`, which can be overridden with `DSH_HOME`. The bundle selects `intellisense-ptc` by default; existing user settings take precedence.

## Tool discovery

`tools.intellisense` always points to the built-in `tools_intellisense` command and appears in the initial namespace prompt. It accepts a list of queries and returns a merged TypeScript `declare namespace global` declaration. A query ending in a dot returns immediate children; a complete command path returns its detailed signature and documentation. Overlapping queries do not produce duplicate declarations.

In PTC mode, call the plugin-owned `tools_run_code`:

```json
{
  "code": "return await tools.intellisense(\"std.\", \"std.cwd\", \"std.fs.\");",
  "description": "Query namespace members and signatures"
}
```

The PTC signature is `function intellisense(...args: string[]): Promise<string>`. Pass separate string arguments, for example `tools.intellisense("std.", "std.cwd")`. An empty string is accepted: `tools.intellisense("")` queries root namespace members. In DSML mode, call the tool named `tools.intellisense` with these named arguments:

```json
{"queries": ["std.", "std.cwd", "std.fs."]}
```

Query an unknown command's signature before calling it directly. Queries are ordinary tool executions: results return through native tool history without interrupting model output, injecting system prompts, or automatically continuing code. Text code fences are for display only.

## PTC execution

The scoped namespace plugin provides `tools_run_code`, with `code` and a short `description` as arguments. Code runs as a strict async function body supporting TS type annotations, top-level await, and explicit return. Each execution creates an independent VM context; state persistence is not guaranteed. `globalThis`, a `vm` namespace, and restart commands are unavailable. Use `console` to log output; execution results return through in-memory streams and IPC. Failed namespace calls throw a `ToolCallError` carrying `toolName`.

The plugin's `NamespaceRuntime` converts positional namespace arguments into actual tool arguments and dispatches through the native guard and execution pipeline, preserving parent/child call records and forwarding additional context. The execution tool uses the plugin's isolated runtime directly, leaving the deployment's default PTC backend available to other modes. Cancellation and timeouts terminate the restricted process; side effects are not automatically replayed.

## Configuration and initial prompts

The main plugin's `Config.mode` is either `ptc` (default) or `native`. Both presets explicitly override the default through `config.mode` in `dsh-intellisense/presentation`. Both modes select native tool presentation within their scope; the plugin filters the model's tool schemas according to the selected mode. Initial prompts and actual tool schemas share the same configuration source: PTC exposes only `tools_run_code`, while native mode exposes the current namespace proxies.

Runtime budgets include `timeoutMs`, `syncTimeoutMs`, `maxOutputBytes`, `maxMessageBytes`, `maxPendingCalls`, `heapMb`, `sandboxProbeTimeoutMs`, and `diagnosticChars`. You can also configure `aliasesFile`.

## Profiles and management UI

Manage named profiles, namespaces, aliases, tool annotations, ordering, and pinned hints on the **dsh-intellisense** plugin's configuration page or through `/api/ts-intellisense`. `presets/intellisense_ptc/aliases.yml` provides shared physical tool aliases and argument-name mappings. DSML uses mapped named arguments; PTC uses the positional arguments shown in query signatures.

The built-in `tools.intellisense` command cannot be renamed, moved, deleted, or unpinned. `tools.profile.load`, `tools.profile.save`, `tools.profile.annotation`, and `tools.profile.commands` provide operations on the current profile; legacy management commands have been removed. Before calling unmounted tools, configure their paths in the management page or provide YAML aliases. Unavailable tools are excluded from execution and query lists. Each session holds its own profile reference.

Native DSML proxies revalidate the actual caller's tool visibility at execution time and pass through the actual tool's native permission checks. Proxies are removed when the session is released or the plugin is unloaded. `dsh-intellisense/namespace` can independently mount native namespace mode without creating a JS runtime.

## Checks

Run from the project root:

```sh
npm run build
node node_modules/eslint/bin/eslint.js --config scripts/eslint_config.mjs src
```

Legacy marker-protocol tests and their standalone script configuration have been removed. Use a fake adapter for targeted verification of both modes; no real model is required.
