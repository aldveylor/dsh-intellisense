# 工具模型

内置工具在 presentation 作用域注册，通过 NamespaceComponent 读取当前会话命名空间。命名空间实现位于 `../namespace/`，搜索引擎实现在 `../search/`。

`tools_intellisense` 内部仅在 native 模式过滤查询结果：命令必须绑定实际工具（deployment=tool），命名空间必须包含未禁用的实际工具后代；console 等纯环境项及空命名空间不返回。PTC 保留环境成员与原有类型声明。

`intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。工具结果卡片使用代码块展示输入/输出 schema 和查询结果（PTC 为 TypeScript，native 为 JSON，错误为 text），原生命名空间代理沿用此展示及输出 schema。物理工具及 native 代理保留 { queries: string[] } 命名参数；PTC 接口为 function intellisense(...args: string[]): Promise<string>，接收多个字符串参数，无需数组或 queries 对象包装，tools.intellisense("") 查询根命名空间，派发时还原物理工具的 queries 字段。两种模式查询时均忽略开头的 global. 前缀，global. 等同于根目录查询。尾点查询列出直接子项，精确路径展开签名和文档，PTC 多查询合并为 TypeScript global 命名空间树；命名空间成员查询仅显示命令的 Profile 简略注释（未配置时取原始文档首行），只有精确函数查询显示完整注释和签名。native 返回 JSON 直接成员列表，实际工具条目省略 description 和 tool 字段，增加 brief 简化注释（优先使用 Profile 简略注释，未配置时取原始文档首行）；精确查询仍附带命名参数 schema；仅精确函数路径查询将对应命令加入系统提示词工具集合，命名空间查询只列举成员，不挂载其中的命令。native 查询会更新会话发现集合、同步工具并发出 system-prompt/change，使下一次组装包含新增工具。结果作为普通工具响应进入原生历史，并保存查询审计。会话释放时清除发现集合。

`tool_commands.ts` 仅注册 Profile load/save/delete/annotation/commands/profiles。save 支持显式名称或当前会话名称，验证递归树与物理命令身份，发布目录并替换当前会话配置；load 无名称只返回草稿，有名称切换会话版本。`../namespace/runtime.ts` 将 annotation 和原始命令列表作为数据传给 VM init，不安装同名函数。

Profile 数据模型声明通过 tools.profile.annotation 按需读取；tools_intellisense 查询结果不自动附加这些声明。

`builtin_trace.ts` 在 presentation 作用域包装内置工具注册，保存实际参数/输出 schema、调用参数、返回值、错误与耗时到独立插件审计。结果保持原始模型内容，字符串结果不再额外 JSON 编码。审计和 Profile annotation 通过调用者上下文的 get() 获取命名空间服务，不要求调用者插件显式注入 commandNamespaces。

`intellisense.ts` 在物理 tools_intellisense 执行内调用 CommandStatistics.recordQueries，使用 intellisenseQueryTargets 解析有效查询目标；native/PTC 共享计数口径，不在 UI 或声明渲染器中计数。命名空间成员查询只计目标命名空间，精确命令查询计该命令路径，重复参数分别累计；运行时 environment 目标排除。详见 namespace/model.md。

`tool_search.ts` 将 tools_search 注册到 presentation 作用域并映射 tools.search。搜索参数直接由 SearchEngineRegistry.selector 生成；引擎注册、卸载或默认方法变更后重新注册工具并通知提示重组。searchEngines 由 NamespaceComponent 持有，通过 commandNamespaces 服务供其它插件注册；主插件和 namespace 独立入口均接受 defaultSearchMethod。搜索只返回当前有效树中的完整命令路径，提示使用 tools.intellisense 获取详细信息。声明、PTC 位置参数和 UI 提示共同读取实际物理 schema 中的方法枚举。

tools.profile.commands 返回完整命令目录的 name、brief、totalCalls；totalCalls 复用命名空间全局统计，供 AI 整理 Profile 时判断调用频率。运行时提示不描述统计更新时机。

PTC 在每次执行前预加载 commands，并由 VM 命令包装同步更新本次执行内对应物理工具的 totalCalls，只更新 VM 视图，不额外通知宿主。native 的 tools.profile.commands 是实际工具函数，每次调用均重新读取 CommandStatistics 全局快照，返回该次读取时的最新累计值，不复用上次返回的数组。

命名空间成员同样保留注释：native 命名空间条目返回 brief；PTC 对直接命中的命名空间、显式查询的命名空间及返回成员的父命名空间链输出描述注释。Profile 自定义描述与内置 tools 等节点描述均从共享运行时树读取。

`tools.profile.profiles` 返回 `Profiles { profiles: string[]; selected: string }`，列表来自全局目录，selected 来自当前会话。native 为无参数命令，每次调用读取最新状态；PTC 为只读字段，每次执行前初始化，并在工具调用成功返回前通过 IPC 刷新，load/save 后同次执行内的读取和持有的对象引用均可见新状态。

Profile save 的 name 省略或为 undefined 时，始终覆盖当前会话选择，忽略树中的 profile.name；创建新目录项必须传入显式字符串名称。支持 save(profile) 和 save(name, profile)，缺少 Profile、非法名称类型或非法树均抛错；写入失败透传异常。参数说明同时进入 native schema 与 PTC 声明。

`tools.profile.delete(name: string)` 删除全局目录中的指定配置；必须显式指定目标名称，省略或传入 undefined 时拒绝调用，删除当前会话配置一律拒绝。其它会话已有快照保留，成功删除后 PTC 的 profiles 字段随工具回复刷新。

`tools.profile.switch(name: string)` 显式切换当前会话配置，必须指定已有名称；可通过 builtinDisabled 禁用，使用普通内置命令的 disableable 权限。load(name?) 保留已有行为。

当前对话通过 save、显式 load(name)、switch(name) 或会话 Profile 下拉框更新工作配置后，统一由 configurationChanged 刷新工具提示，并调用 Agent.inject 注入英文 notice：`Profile updated to <profile name>`。读取草稿、失败操作及删除其它配置不注入；通知仅进入更新的对话。
