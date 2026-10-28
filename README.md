![Intellisense — Tool discovery, on demand.](assets/banner.png)

# dsh-intellisense

English | [简体中文](README.zh-cn.md)

![NPM Version](https://img.shields.io/npm/v/@aldveylor/dsh-intellisense)

dsh-intellisense helps you organize and discover tools in DeepSeek Harness. Group tools, give them clear names and descriptions, and save reusable profiles for different tasks. The agent can look up the tools it needs on demand.

## Usage

Read the [usage guide](docs/en/usage.md) for tool grouping, agent visibility and interface operations. You can also open it from the plugin configuration page.

## Installation

**Official DSH Desktop:** Open **Settings → Plugins** in the app, search for `@aldveylor/dsh-intellisense`, and install it through the app's plugin manager. No command line is needed.

**Regular dsh web:** Run this command, then restart dsh web:

```sh
dsh plugin --profile web add @aldveylor/dsh-intellisense
```

**Custom profile:** Replace `web` in that command with your host's actual profile name:

```sh
dsh plugin --profile <profile> add @aldveylor/dsh-intellisense
```

Follow your host's restart instructions.

## Development

Requires Node.js >=24 and DeepSeek Harness >=0.2.1-rc.2.

### Install from npm

Start DeepSeek Harness once to initialize the profile you want to use, then stop it. In that profile's directory (the directory containing its `package.json`), run:

```sh
npm install @aldveylor/dsh-intellisense
```

In the same `package.json`, append `"@aldveylor/dsh-intellisense"` to the existing `dsh.profile.bundles` list, keeping the other entries. Restart DeepSeek Harness with that profile.

Alternatively, open **Plugins** in the DeepSeek Harness sidebar and install `@aldveylor/dsh-intellisense` from the npm registry, with the bundle enabled. This handles installation and activation for the current profile.

### Run from source

From the project root, with pnpm installed, run:

```sh
pnpm install --frozen-lockfile
./run.sh
```

This starts a separate development profile for trying the plugin locally.

## Tool management

Read the [usage guide](docs/en/usage.md), also available from the configuration page. Screenshots below use light mode.

### Namespace management

The namespace tree shows tool groups, call names, and descriptions. Hover a namespace for its name, full path, and notes; hover a command for its summary, full documentation, and call totals. Its original command name opens a second tooltip with tool details. Expand groups, double-click names or comments to edit them, drag sibling entries to reorder them, and set pinned hint levels. Use the controls above the tree to switch, save, or save a copy of a profile for reuse across different tool configurations.

![Tool namespace table with profile selection and tree editing](assets/en/namespace_table.png)

### Adding tools

Click the tool icon beside “Namespace tree” to open the tool picker. The unmounted count opens a filtered list. Search by name, path, or description, then click an ordinary tool card to add it to the current node. Built-in plugin commands appear as disabled gray cards.

![Tool picker with search, sorting, and disabled built-in command cards](assets/en/tools.png)

### Tool details

Hover a card for its original name, description, parameters, return type, and call totals. Parameter types have nested tooltips showing the type expression directly. Table titles sit outside their tables, and columns size to content. Hold Alt to keep a tooltip in place, then move into it to scroll manually.

![Bash tool details and type display](assets/en/tooltip.png)

## License

[Apache License 2.0](LICENSE).
