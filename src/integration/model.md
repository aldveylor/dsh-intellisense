# 集成模型

presentation.ts 按作用域选择 native/PTC，均通过 DSH native 工具执行。PTC 在自己的作用域创建 namespaceRuntime/codeRuntime，不替换全局后端。profile 配置可锁定初始化名称；现有同名会话仍保留原快照版本。没有显式 presentation 的会话不启用此插件。

ctx.intellisense 包含 profiles（同 ctx.toolsNamespace）、toolAdditions、statistics、inspectStatistics、searchEngines。toolAdditions 位于 tool_additions/，只保存独立工具元数据；内置固定身份、契约与预加载行为由实际 Profile 函数类实现。

agent_session_addition.ts 公开只读 name、profile: ProfileReference、会话统计和 save()。profile.pointer 是全局递增版本号，profile.snapshot 返回独立值，不能借此修改会话版本。save() 只保存引用。会话初始化、父子继承、恢复和显式 switch 由 ProfileSessions 负责，不生成内部会话 registry。

NamespaceIntegration 构造时分别接收 ToolsNamespace 服务接口、ToolCatalog 物理目录接口与 ProfileSessionCollection；具名数据与默认选择经 ToolsNamespace，物理目录接口不含 Profile 操作，不导入 NamespaceComponent，也不通过 namespace.registry 访问具体服务内部。intellisense.profiles 保留传入服务的接口身份。

NamespaceIntegration 是工具作用域、发现集合、请求位置和代理生命周期的内部编排层。get/entries 直接消费引用对应的 ProfileSnapshot 及其原节点；原生工具、搜索、inspect、提示词、PTC 绑定只生成各自需要的扁平数据或文本。不存在 tree/manifest 或重建语义树的中间层。

discover 在当前会话快照上解析精确路径，只将显式查询的可用命令加入原生发现集合。syncNative 从原节点导出契约并注册工具，保留 DSH guard、父子审计、附加上下文和结束回合语义。物理工具作用域变化只改变可调用契约，不修改快照指针。

原生代理通过 dispatchTool 保留物理工具的完整返回值，与输出 schema 和 presentResult 的输入结构一致；单字段解包和 discardResult 仅用于 PTC 返回值投影。

plugin.ts 是命名空间执行集成装配入口，依赖已挂载的 toolsNamespace 和 共享存储基础设施，不创建或发布 Profile 服务。默认根入口先挂载 profile/plugin.ts，再挂载 integration/plugin.ts。ProfileSessionCollection 隔离会话实现；Profile 服务存储的关闭晚于集成层统计刷新。

tool_catalog.ts 的 PhysicalToolCatalog 单独拥有物理工具契约与 ToolAdditions，不持有 Profile 存储或目录。plugin.ts 只消费 toolsNamespace 接口以及内部 intellisenseStorage；不存在额外的 profileBackend 业务入口。ctx.intellisense 保持独立，profiles 仅保留对 toolsNamespace 的同一对象引用。

固定等级 1 的命令提示优先使用节点 function.doc 简化注释，包括受保护的 tools.profile 成员；内置命令固定等级 2 继续使用模式对应的完整接口说明。
