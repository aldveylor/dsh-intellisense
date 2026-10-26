# @aldveylor/dsh-intellisense

[English](../en/README.md) | [项目首页](../../README.md)

为 DeepSeek Harness 提供共享 Profile、命名空间工具调用和按需 TypeScript 签名查询。

两个 Agent Mode 使用相同的命名空间配置：

- **Intellisense PTC**（`intellisense-ptc`）：通过插件自有的 `tools_run_code` 执行 TS/JS，在程序中调用 `std.cwd()`、`std.fs.read(...)` 等命令。
- **Intellisense**（`intellisense`）：通过原生 DSML 直接调用 `std.cwd`、`std.fs.read`、`tools.intellisense` 等命名空间工具。

## 启动

需要 Node.js >=24、DSH >=0.2.1-rc.2。运行时使用 Node.js 原生权限（`--permission`）。Node.js 24 权限模型不限制网络访问。运行时加载时验证隔离条件。以下命令均在项目根目录执行。

```sh
pnpm install --frozen-lockfile
./run.sh
```

`run.mjs` 构建本包并通过原生 bundle 登记到 Web profile，支持 `--plugin <目录>`。默认工作区为 `build/workspace`，配置和数据位于 `build/.dsh`，可通过 `DSH_HOME` 指定其他目录。bundle 默认选择 `intellisense-ptc`；已有用户层设置优先。

## 工具查询

`tools.intellisense` 固定指向内置 `tools_intellisense`，始终出现在初始命名空间提示中。参数是查询列表，结果是一个合并后的 TypeScript `declare namespace global` 声明：尾点查询返回直接子项，完整命令路径返回详细签名和文档。重叠查询不会产生重复声明。

PTC 模式调用插件自有的 `tools_run_code`：

```json
{
  "code": "return await tools.intellisense(\"std.\", \"std.cwd\", \"std.fs.\");",
  "description": "Query namespace members and signatures"
}
```

PTC 签名为 `function intellisense(...args: string[]): Promise<string>`，查询路径以多个字符串参数传入，例如 `tools.intellisense("std.", "std.cwd")`。接受空字符串参数：`tools.intellisense("")` 查询根命名空间成员。DSML 模式直接调用名为 `tools.intellisense` 的工具，命名参数为：

```json
{"queries": ["std.", "std.cwd", "std.fs."]}
```

未知命令先查询签名，再直接调用。查询是普通工具执行，结果随原生工具历史返回，不中断模型输出、不注入系统提示词，也不自动续写代码。文本代码围栏只用于展示。

## PTC 执行

`tools_run_code` 由命名空间插件在 presentation 作用域提供，参数包含 `code` 和简短的 `description`。程序是严格 async 函数体，支持 TS 类型标注、顶层 await 和显式 return。每次执行创建独立 VM 上下文，不保证环境连续，不支持 `globalThis`，也不提供 `vm` 命名空间或重启命令。使用 `console` 记录输出，通过内存流及 IPC 返回执行结果。命名空间调用失败时抛出带 `toolName` 的 `ToolCallError`。

插件的 `NamespaceRuntime` 将命名空间位置参数转换为实际工具参数，通过原生 guard 和执行流水线派发，保留父子调用记录和附加上下文转发。执行入口直接使用插件的受限运行时，部署的全局 PTC 后端仍供其它模式使用。取消和超时会终止受限进程，副作用不会自动重放。

## 配置与初始提示词

两个 preset 通过 `@aldveylor/dsh-intellisense/presentation` 的 `config.mode` 选择 `ptc` 或 `native`，主插件配置运行时预算与别名；两个模式均在作用域内选择原生工具呈现，由插件按模式过滤模型工具 schema。初始提示词与实际工具 schema 使用同一配置来源：PTC 仅暴露 `tools_run_code`，native 暴露当前命名空间代理。

运行时预算包括 `timeoutMs`、`syncTimeoutMs`、`maxOutputBytes`、`maxMessageBytes`、`maxPendingCalls`、`heapMb`、`sandboxProbeTimeoutMs` 和 `diagnosticChars`，另可配置 `aliasesFile`。

## Profile 与管理界面

在插件 **@aldveylor/dsh-intellisense** 的配置页，或 `/api/ts-intellisense` 管理具名 Profile、命名空间、别名、工具注释、排序与固定提示。默认不加载额外的 YAML 别名；可通过 `aliasesFile` 指定共享的物理工具别名及参数名映射文件。DSML 使用映射后的命名参数，PTC 使用查询签名中的位置参数。

`tools.intellisense` 是不可改名、移动、删除或取消固定提示的内置命令。`tools.profile.load`、`tools.profile.save`、`tools.profile.annotation` 和 `tools.profile.commands` 提供当前 Profile 操作；旧管理命令已移除。未挂载的工具需通过管理页面配置路径或提供 YAML 别名后调用。失效工具不进入执行或查询清单；每会话持有独立 Profile 引用。

原生 DSML 代理在执行时重新验证实际调用者的工具可见性，并经过实际工具的原生权限检查。会话释放或插件卸载都会移除代理。`@aldveylor/dsh-intellisense/namespace` 可独立挂载原生命名空间模式，不创建 JS 运行时。

### 命名空间管理

命名空间树展示工具分组、调用名称与工具说明。悬停命名空间可查看名称、完整路径和注释；悬停命令可查看简化注释、完整文档及调用统计，其原始命令名可打开第二层工具详情。可展开分组、双击名称或注释进行编辑，拖动同级条目调整顺序，并设置固定提示级别；顶部可切换、保存或另存为 Profile，方便复用不同的工具配置。

![工具命名空间表：Profile 选择与树形工具管理](namespace_table.png)

### 添加工具

点击“命名空间树”标题后的工具图标打开添加工具界面；未挂载工具数量入口可筛选尚未挂载的工具。可按名称、路径或描述搜索，点击普通工具卡片加入当前节点，再在树中调整名称和分组。本插件内置命令以灰色禁用卡片显示，不能重复挂载。

![添加工具：搜索、排序和灰色内置命令卡片](tools.png)

### 工具详情

悬停工具卡片可查看原始名称、描述、参数、返回类型和调用统计。参数类型拥有二层 Tooltip，类型直接显示表达式；参数与统计标题置于表格外，列宽按内容自适应。按住 Alt 固定提示，移入可手动滚动。

![Bash 工具详情与类型展示](tooltip.png)

## 文档截图

安装截图依赖到主目录（脚本可复用 ~/node_modules 中的 Playwright）：

```sh
npm install --prefix ~ playwright
~/node_modules/.bin/playwright install chromium
pnpm run screenshots
```

脚本先构建项目，再使用内存中的固定示例 Profile 和生产管理页面，为中英文各更新 namespace_table.png、tools.png 和 tooltip.png，并移除旧 unmounted_tools.png。不会读取或修改用户配置，也不会执行示例工具。PNG 通过 Git LFS 管理。

## 许可

[Apache License 2.0](../../LICENSE)。

## 检查

在项目根目录执行：

```sh
pnpm run build
node node_modules/eslint/bin/eslint.js --config scripts/eslint_config.mjs src
```

已移除旧标记协议测试及其独立脚本配置。定向验证双模式流程时使用 fake adapter，无需真实模型。
