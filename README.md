# @aldveylor/dsh-intellisense

![Intellisense — Tool discovery, on demand.](assets/banner.png)

[简体中文](README.zh-cn.md)

dsh-intellisense adds namespace-based tool management, reusable profiles, and on-demand tool discovery to DeepSeek Harness. Its management interface supports tool grouping, mount paths, ordering, and pinned prompt detail levels. Profiles can be saved and reused across sessions.

The plugin maps the tool catalog into namespaces and provides members and call signatures on demand, reducing tool information in the initial prompt. Intellisense PTC runs TypeScript/JavaScript in a restricted Node.js runtime and calls tools through namespaces; Intellisense calls tools directly through native DSML. Both modes share profile configuration and route tool calls through native permission checks and execution.

Read profiles with `tools.profile.load()` and save them with `tools.profile.save()`. `tools.profile.annotation` provides the TypeScript data model, with field-level `/** @default ... */` comments documenting defaults. Omitted `permissions` or permission fields use ordinary node permissions; the server still enforces protected node restrictions. `fixedLevel` defaults to `0` and `disabled` to `false`. Saved profiles omit default permissions, empty permission objects, and default pin levels and disabled flags.

Both Agent Modes use the same namespace configuration:

- **Intellisense PTC** (`intellisense-ptc`): execute TS/JS through the plugin-owned `tools_run_code` and call commands such as `std.cwd()` and `std.fs.read(...)` from code.
- **Intellisense** (`intellisense`): call namespace tools such as `std.cwd`, `std.fs.read`, and `tools.intellisense` directly through native DSML.

## Getting started

Requires Node.js >=24 and DSH >=0.2.1-rc.2. The runtime uses Node.js native permissions (`--permission`). Node.js 24 permissions do not restrict network access. Isolation requirements are checked when the runtime loads.

Run these commands from the project root:

```sh
pnpm install --frozen-lockfile
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

Each preset selects `ptc` or `native` through `config.mode` in `@aldveylor/dsh-intellisense/presentation`. The main plugin configures runtime budgets and aliases. Both modes select native tool presentation within their scope; the plugin filters the model's tool schemas according to the selected mode. Initial prompts and actual tool schemas share the same configuration source: PTC exposes only `tools_run_code`, while native mode exposes the current namespace proxies.

Runtime budgets include `timeoutMs`, `syncTimeoutMs`, `maxOutputBytes`, `maxMessageBytes`, `maxPendingCalls`, `heapMb`, `sandboxProbeTimeoutMs`, and `diagnosticChars`. You can also configure `aliasesFile`.

## Profiles and management UI

Manage named profiles, namespaces, aliases, tool annotations, ordering, and pinned hints on the **@aldveylor/dsh-intellisense** plugin's configuration page or through `/api/ts-intellisense`. No additional YAML aliases are loaded by default; use `aliasesFile` to specify a file of shared physical tool aliases and argument-name mappings. DSML uses mapped named arguments; PTC uses the positional arguments shown in query signatures.

The built-in `tools.intellisense` command cannot be renamed, moved, deleted, or unpinned. `tools.profile.load`, `tools.profile.save`, `tools.profile.annotation`, and `tools.profile.commands` provide operations on the current profile; legacy management commands have been removed. Before calling unmounted tools, configure their paths in the management page or provide YAML aliases. Unavailable tools are excluded from execution and query lists. Each session holds its own profile reference.

Native DSML proxies revalidate the actual caller's tool visibility at execution time and pass through the actual tool's native permission checks. Proxies are removed when the session is released or the plugin is unloaded. `@aldveylor/dsh-intellisense/namespace` can independently mount native namespace mode without creating a JS runtime.

### Namespace management

The namespace tree shows tool groups, call names, and descriptions. Hover a namespace for its name, full path, and notes; hover a command for its summary, full documentation, and call totals. Its original command name opens a second tooltip with tool details. Expand groups, double-click names or comments to edit them, drag sibling entries to reorder them, and set pinned hint levels. Use the controls above the tree to switch, save, or save a copy of a profile for reuse across different tool configurations.

![Tool namespace table with profile selection and tree editing](assets/en/namespace_table.png)

### Adding tools

Click the tool icon beside “Namespace tree” to open the tool picker. The unmounted count opens a filtered list. Search by name, path, or description, then click an ordinary tool card to add it to the current node. Built-in plugin commands appear as disabled gray cards.

![Tool picker with search, sorting, and disabled built-in command cards](assets/en/tools.png)

### Tool details

Hover a card for its original name, description, parameters, return type, and call totals. Parameter types have nested tooltips showing the type expression directly. Table titles sit outside their tables, and columns size to content. Hold Alt to keep a tooltip in place, then move into it to scroll manually.

![Bash tool details and type display](assets/en/tooltip.png)

## Documentation screenshots

Install screenshot dependencies in your home directory (the script can reuse Playwright in ~/node_modules):

```sh
npm install --prefix ~ playwright
~/node_modules/.bin/playwright install chromium
pnpm run screenshots
```

The script builds the project, then uses a fixed in-memory example profile and the production management page to update namespace_table.png, tools.png, and tooltip.png in both languages, removing the old unmounted_tools.png. It does not read or modify user configuration or execute example tools. PNG files are managed with Git LFS.

## License

[Apache License 2.0](LICENSE).

## Checks

Run from the project root:

```sh
pnpm run build
node node_modules/eslint/bin/eslint.js --config scripts/eslint_config.mjs src
```

Legacy marker-protocol tests and their standalone script configuration have been removed. Use a fake adapter for targeted verification of both modes; no real model is required.
