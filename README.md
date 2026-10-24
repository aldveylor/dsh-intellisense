# dsh-intellisense

Documentation: [English](docs/en/README.md) | [简体中文](docs/zh/README.md)

Brief: [简体中文](#简体中文) | [English](#english)

## 简体中文

dsh-intellisense 为 DeepSeek Harness 提供命名空间工具管理、可复用的 Profile 配置和按需工具查询。管理界面支持工具分组、别名、排序与提示固定级别，Profile 可保存并在会话间复用。

插件将工具目录映射为命名空间，按需提供成员列表与调用签名，减少初始提示中的工具信息。Intellisense PTC 在受限 Node.js 运行时中执行 TypeScript/JavaScript，并通过命名空间调用工具；Intellisense 则通过原生 DSML 直接调用工具。两种模式共享 Profile 配置，工具调用均经过原生权限检查与执行流程。

## English

dsh-intellisense adds namespace-based tool management, reusable profiles, and on-demand tool discovery to DeepSeek Harness. Its management interface supports tool grouping, aliases, ordering, and pinned prompt detail levels. Profiles can be saved and reused across sessions.

The plugin maps the tool catalog into namespaces and provides members and call signatures on demand, reducing tool information in the initial prompt. Intellisense PTC runs TypeScript/JavaScript in a restricted Node.js runtime and calls tools through namespaces; Intellisense calls tools directly through native DSML. Both modes share profile configuration and route tool calls through native permission checks and execution.
