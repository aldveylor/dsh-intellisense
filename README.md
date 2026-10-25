# dsh-intellisense

![Intellisense — Tool discovery, on demand.](docs/banner.png)

Documentation: [English](docs/en/README.md) | [简体中文](docs/zh/README.md)

Brief: [简体中文](#简体中文) | [English](#english)

## 简体中文

dsh-intellisense 为 DeepSeek Harness 提供命名空间工具管理、可复用的 Profile 配置和按需工具查询。管理界面支持工具分组、别名、排序与提示固定级别，Profile 可保存并在会话间复用。

插件将工具目录映射为命名空间，按需提供成员列表与调用签名，减少初始提示中的工具信息。Intellisense PTC 在受限 Node.js 运行时中执行 TypeScript/JavaScript，并通过命名空间调用工具；Intellisense 则通过原生 DSML 直接调用工具。两种模式共享 Profile 配置，工具调用均经过原生权限检查与执行流程。

### 命名空间管理

命名空间树展示工具分组、调用名称与工具说明。悬停命名空间可查看名称、完整路径和注释；悬停命令可查看简化注释、完整文档及调用统计，其原始命令名可打开第二层工具详情。可展开分组、双击名称或注释进行编辑，拖动同级条目调整顺序，并设置固定提示级别；顶部可切换、保存或另存为 Profile，方便复用不同的工具配置。

![工具命名空间表：Profile 选择与树形工具管理](docs/zh/namespace_table.png)

### 添加工具

点击“命名空间树”标题后的工具图标打开添加工具界面；未挂载工具数量入口可筛选尚未挂载的工具。可按名称、路径或描述搜索，点击普通工具卡片加入当前节点，再在树中调整名称和分组。本插件内置命令以灰色禁用卡片显示，不能重复挂载。

![添加工具：搜索、排序和灰色内置命令卡片](docs/zh/tools.png)

### 工具详情

悬停工具卡片可查看参数、返回类型与调用统计；参数类型可展开二层提示，直接展示类型表达式。按住 Alt 可固定当前提示，方便移入查看或滚动。

![Bash 工具详情与类型展示](docs/zh/tooltip.png)

需要 Node.js >=24、DSH >=0.2.1-rc.2。采用 [Apache License 2.0](LICENSE)。

## English

dsh-intellisense adds namespace-based tool management, reusable profiles, and on-demand tool discovery to DeepSeek Harness. Its management interface supports tool grouping, aliases, ordering, and pinned prompt detail levels. Profiles can be saved and reused across sessions.

The plugin maps the tool catalog into namespaces and provides members and call signatures on demand, reducing tool information in the initial prompt. Intellisense PTC runs TypeScript/JavaScript in a restricted Node.js runtime and calls tools through namespaces; Intellisense calls tools directly through native DSML. Both modes share profile configuration and route tool calls through native permission checks and execution.

### Namespace management

The namespace tree shows tool groups, call names, and descriptions. Hover a namespace for its name, full path, and notes; hover a command for its summary, full documentation, and call totals. Its original command name opens a second tooltip with tool details. Expand groups, double-click names or comments to edit them, drag sibling entries to reorder them, and set pinned hint levels. Use the controls above the tree to switch, save, or save a copy of a profile for reuse across different tool configurations.

![Tool namespace table with profile selection and tree editing](docs/en/namespace_table.png)

### Adding tools

Click the tool icon beside “Namespace tree” to open the tool picker. The unmounted count opens a filtered list. Search by name, path, or description, then click an ordinary tool card to add it to the current node. Built-in plugin commands appear as disabled gray cards.

![Tool picker with search, sorting, and disabled built-in command cards](docs/en/tools.png)

### Tool details

Hover a tool card for parameters, return types, and call totals. Parameter types open nested tooltips with the type expression itself. Hold Alt to keep a tooltip in place while moving into it to read or scroll.

![Bash tool details and type display](docs/en/tooltip.png)

Requires Node.js >=24 and DSH >=0.2.1-rc.2. Licensed under the [Apache License 2.0](LICENSE).
