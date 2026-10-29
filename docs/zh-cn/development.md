# 开发文档：Agent preset 与内置工具

[English](../en/development.md) · [使用文档](usage.md)

本文说明如何在 agent preset 中配置本插件，以及模型如何调用插件内置接口。以下配置和接口以仓库当前实现为准。

## Preset 的组成

主组件 `@aldveylor/dsh-intellisense` 提供命名空间、Profile 管理与运行时基础服务。独立组件 `@aldveylor/dsh-intellisense/preset` 注册两个内置 preset：

| 目录 | Preset ID | 名称 | `config.mode` |
| --- | --- | --- | --- |
| `presets/intellisense_ptc/` | `intellisense-ptc` | Intellisense PTC | `ptc` |
| `presets/intellisense/` | `intellisense` | Intellisense | `native` |

每个目录的 `preset.yml` 声明 `id`、`name`、`description`（字符串）和 `order`（数字），不接受额外字段；`agent.cordis.yml` 是完整的 agent 插件列表，包括工具、技能、规划、压缩与子 agent 等配置。注册组件加载、校验并注册这两份声明，卸载时释放注册，不自动注入或修改 presentation。它复用兼容层的 DSH 版本判断：旧版在 delegation 分组中补充 `@deepseek-ai/dsh-tool-subagent-control/list-agents`，从 `0.2.2-alpha.2` 起不再注册这个已移除的入口。

[`cordis.patch.yml`](../../cordis.patch.yml) 同时挂载主组件与 preset 注册组件，并把 `agent-preset-registry.config.default` 和 `selectedDefault` 设为 `intellisense-ptc`。这两个字段属于 preset 注册器；执行模式由各 preset 自己的 presentation 配置决定。

## Presentation config

在自定义 preset 的 `agent.cordis.yml` 插件列表中加入：

```yaml
- id: intellisense-presentation
  name: '@aldveylor/dsh-intellisense/presentation'
  config:
    mode: ptc
    profile: coding
```

这段配置依赖已挂载的主组件和 DSH 工具服务，必须运行在 agent 或 preset 作用域。`profile: coding` 假定插件的工具 Profile 目录中已存在 `coding`；若要让用户自由选择 Profile，删除该行。

| 字段 | 类型 | 必填 | 行为 |
| --- | --- | --- | --- |
| `mode` | `native` 或 `ptc` | 否 | 选择工具呈现、初始提示词及执行方式，默认 `native` |
| `profile` | 长度 1–80 的字符串 | 否 | 固定当前会话使用的具名工具 Profile，无默认值 |

配置使用严格 schema，未知字段会被拒绝。Preset ID、插件条目的 `id` 和 `config.mode` 各自独立；应保留内置条目 ID `intellisense-presentation`，通过 `mode` 选择执行方式。只有显式配置 presentation 的作用域及其继承作用域启用本插件模式；主组件或 preset 注册组件单独加载不会自动设置模式。查找配置时使用作用域链中最近的 presentation 配置；该配置省略 `mode` 时使用 `native`，即使外层 presentation 使用 `ptc`。

### `mode: native`

使用原生 DSML 工具调用，不创建会话代码运行时。初始工具集合包含启用的 `tools.inspect` 和固定等级 2 的命令。固定等级 1 只提供路径和摘要；精确查询命令路径后，该命令才加入当前会话可调用集合。命名空间成员查询不会批量挂载其中的命令。

原生代理工具名由命名空间路径转换：添加 `ns_` 前缀，并把 `.` 替换为 `__`。例如 `tools.profile.load` 对应 `ns_tools__profile__load`，参数采用命名对象。模型应使用当前工具列表实际提供的名称。

### `mode: ptc`

模型通过插件专有的 `tools_run_code` 执行 TypeScript/JavaScript async 函数体，代码内使用命名空间函数和位置参数。工具子调用仍通过 DSH 原生执行流水线处理权限与审计。此模式创建独立的作用域运行时服务，不替换全局 `ptcRuntime`。

| `tools_run_code` 参数 | 说明 |
| --- | --- |
| `code: string`，必填 | async 函数体，可使用 `await`；通过显式 `return` 返回结果 |
| `description: string`，必填 | 程序的简短说明 |
| `timeoutMs: number`，可选 | 正的有限毫秒数；默认使用主组件的 `timeoutMs`，实际预算不超过该配置 |

成功返回 `{ logs: string[], result?: JSON值 }`。`console` 输出进入 `logs`。局部声明不会跨执行保留；可通过 `globalThis` 保存会话内变量，但 VM 重启会丢失状态。

```json
{
  "code": "return await tools.inspect(['tools.', 'tools.profile.load']);",
  "description": "查看内置工具接口"
}
```

### `profile` 的选择与锁定

此处 Profile 指本插件的工具命名空间配置，不是 DSH 启动使用的运行配置，也不是 agent preset。

- 指定 `profile`：会话使用该目录配置；首页 Profile 按钮仍显示但置灰，UI 切换接口和 `tools.profile.switch` 拒绝切换（`session_profile_locked`）。名称必须对应已存在的目录项。
- 省略 `profile`：普通新会话捕获 UI 选择的全局默认 Profile；子 agent 首次初始化继承父会话当前工作快照，包括未保存修改。之后父子快照相互独立。
- 目录保存与会话工作快照分开。即使指定了 `profile`，`load`、`save`、`apply` 仍可读取或写入目录，但保存不会自动刷新现有会话快照。

## 内置工具接口

以下名称为命名空间路径。PTC 中直接调用异步函数；native 中通过原生代理传入命名参数。`tools.inspect` 默认固定为等级 2，其余内置命令默认不固定，可先查询完整接口。禁用节点及其后代会退出发现、提示、调用绑定和预加载；`tools.inspect` 本身也允许禁用。

### 发现与搜索

```ts
await tools.inspect(['']);                      // 根命名空间
await tools.inspect(['tools.', 'tools.profile.load']);
```

`inspect(queries: string[]): Promise<string>`：尾点查询直接成员，精确命令路径查询完整签名和文档；忽略开头的 `global.`。PTC 返回 TypeScript 声明字符串，native 返回 JSON 字符串，并在精确命令查询后更新当前会话工具集合。查询使用可用的挂载路径，不能按原始物理工具名查询。

Native 参数示例：`ns_tools__inspect` 接收 `{"queries":["tools.","tools.profile.load"]}`。物理注册名为 `tools_inspect`；物理名称与模型看到的命名空间代理名称属于不同层。

`tools.search` 返回 `Promise<string[]>`，结果为当前有效树中按相关性排序的完整命令路径；排除失效和禁用路径，不会自动发现或挂载命令，详情仍需 `inspect`。

| 参数（按 PTC 位置顺序） | 类型与默认值 |
| --- | --- |
| `keywords` | 必填 `string[]`，关键词按 OR 匹配 |
| `method` | 可选，当前已注册搜索方法；默认优先 `bm25`，缺少可选依赖时回退 `accurate` |
| `max_results` | 可选，非负安全整数，默认 `10` |
| `target` | 可选，`name` / `description` / `parameters` / `all`，默认 `all` |
| `namespace_path` | 可选，限定命名空间及后代，默认 `""`（整棵树） |

主组件的 `defaultSearchMethod` 可调整默认方法。只有一个搜索引擎时，接口会移除 `method` 参数，PTC 后续位置参数随之前移；应以 `inspect(['tools.search'])` 返回的实时签名为准。空关键词或 `max_results: 0` 返回空数组。

### Profile 管理函数

| PTC 调用 | Native 参数对象 | 返回与作用 |
| --- | --- | --- |
| `load(name?)` | `{name?}` | `Promise<Profile>`；省略名称读取当前会话草稿，指定名称读取目录，不切换会话 |
| `save(profile)` / `save(name, profile)` | `{name?, profile}` | `Promise<string \| null>`；完整替换目录树，显式名称可创建新目录项；省略名称保存到当前会话选择的名称 |
| `apply(value)` / `apply(name, value)` | `{name?, value}` | `Promise<string \| null>`；读取后递归合并 patch，再写目录；显式名称必须已存在 |
| `switch(name)` | `{name}` | PTC `Promise<void>`，native `null`；从目录替换当前会话快照并刷新提示和工具；锁定 Profile 时拒绝 |
| `setdefault(name)` | `{name}` | PTC `Promise<void>`，native `null`；将已有目录项设为全局默认，不修改已有会话 |
| `remove(name)` | `{name}` | PTC `Promise<void>`，native `null`；删除具名目录项，禁止省略名称或删除当前会话所选 Profile；其它会话快照保留 |

表中函数都位于 `tools.profile`。PTC 的 `save` / `apply` 也支持双参数形式首参为 `undefined`。Native 代理如 `ns_tools__profile__apply` 使用表中的参数名；底层物理注册名为 `tools_profile_apply`，其它函数同理。

`save` / `apply` 成功时，无建议返回 `null`；当 inspect 不可用且仍有启用命令未固定为等级 2 时返回建议字符串，写入仍已成功。校验失败或权限违规抛错。两者只更新目录，验证结果用 `load(name)`，需要应用到当前会话时显式 `switch(name)`。

### Profile 数据接口

| 接口 | PTC | Native 无参数调用与返回 |
| --- | --- | --- |
| `tools.profile.profiles` | 只读对象 | `profiles({})` → `{ profiles: string[], selected: string }` |
| `tools.profile.annotation` | 只读字符串，包含读写模型的 TypeScript 声明 | `annotation({})` → 写入模型 JSON Schema 字符串 |
| `tools.profile.tools` | 只读数组 | `tools({})` → `ToolBrief[]` |

Native 表格使用命名空间简写，实际调用例如 `ns_tools__profile__profiles`，参数为 `{}`。PTC 这三个成员是预加载值，不能写成 `profiles()` / `annotation()` / `tools()`；每次执行前装载，`profiles` 在成功工具调用后还会刷新。

`ToolBrief` 为 `{ name: string, brief: string, paths: string[], totalCalls: number }`。`name` 是原始物理工具名，目录不包含插件内置工具；`paths` 来自当前会话 Profile，包含禁用及当前作用域不可用的挂载路径，未挂载时为空。`totalCalls` 是跨会话累计调用次数。保存目录后 `paths` 不代表新目录内容，应通过 `load(name)` 验证。

### 写入模型与增量修改

`load` 返回含 `name` 的 Profile 及可选只读 `permissions`。写入的 `ProfileWrite` 仅包含可选 `brief` 和 `root`，禁止 `name` 及任意层级的 `permissions`；匿名 `root` 只允许 `type: 'namespace'` 与 `children`。宿主扩展可从包根入口导入 `profileWrite(loaded)` 投影为写入模型。模型内可读取 `tools.profile.annotation` 获取完整类型。

普通命名空间节点允许 `type: 'namespace'`、`description?`、`children?`、`fixedLevel?: 0 | 1`、`disabled?: boolean`；函数节点允许 `type: 'function'`、`function: { tool: string, doc?: string }`、`fixedLevel?: 0 | 1 | 2`、`disabled?: boolean`。`children` 的键就是成员名。固定等级 0 表示不固定，1 表示简略提示，2 表示详细提示（native 中直接注册命令）。

完整 `save` 必须保留受保护的 `tools` 子树及其身份、路径与文档，省略普通挂载会删除该挂载。`tools` 在 `save` 中默认禁用，需显式写 `disabled: false` 保持启用。

`apply` 接收递归部分写入模型：未提交字段保留，`children` 按成员键合并，数组整体替换，`null` 删除可选字段或成员，不能删除必填字段。它保留未提交的禁用状态，不采用 `save` 默认禁用 tools 的规则。改名或移动普通挂载时，需要删除旧键并添加新键，否则两个挂载都会保留。受保护节点规则始终由服务端校验。

下面的 PTC 示例修改已有目录项的摘要，然后显式应用。适用于未被 `config.profile` 锁定且对应工具启用的会话：

```ts
const name = tools.profile.profiles.selected;
const advisory = await tools.profile.apply(name, { brief: 'Coding tools' });
const saved = await tools.profile.load(name);
await tools.profile.switch(name);
return { advisory, saved };
```

## 修改配置后的核对

1. 以两份内置 `agent.cordis.yml` 为完整组合参考，自定义 preset 时保留需要的工具插件。使用 PTC 时设置 `mode: ptc`，省略 `mode` 时使用默认的 `native` 模式。
2. 在已有 Profile 上试用 `profile`，确认锁定行为；省略该项时确认默认选择与父会话继承。
3. 在 PTC 中通过 `tools_run_code` 检查发现接口和预加载字段；在 native 中先列举命名空间，再精确查询命令并调用。
4. 修改内置 preset 或 TypeScript 实现时运行相应检查；仅修改本文档无需构建或运行完整测试。

实现入口：[`src/preset/index.ts`](../../src/preset/index.ts)、[`src/integration/presentation.ts`](../../src/integration/presentation.ts)、[`src/runtime/builtins.ts`](../../src/runtime/builtins.ts)、[`src/tools/tool_commands.ts`](../../src/tools/tool_commands.ts)。
