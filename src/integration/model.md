# 集成模型

presentation.ts 按作用域选择 native/PTC，均通过 DSH native 工具执行。PTC 在自己的作用域创建 namespaceRuntime/codeRuntime，不替换全局后端。profile 配置可锁定初始化名称；现有同名会话仍保留原快照版本。没有显式 presentation 的会话不启用此插件。

ctx.intellisense 包含 profiles（同 ctx.toolsNamespace）、toolAdditions、statistics、inspectStatistics、searchEngines。toolAdditions 位于 tool_additions/，只保存独立工具元数据；内置固定身份、契约与预加载行为由实际 Profile 命令类实现。

agent_session_addition.ts 公开只读 name、profile: ProfileReference、会话统计和 save()。profile.pointer 是全局递增版本号，profile.snapshot 返回独立值，不能借此修改会话版本。save() 只保存引用。会话初始化、父子继承、恢复和显式 switch 由 ProfileSessions 负责，不生成内部会话 registry。

NamespaceIntegration 是工具作用域、发现集合、请求位置和代理生命周期的内部编排层。get/entries 直接消费引用对应的 ProfileSnapshot 及其原节点；原生工具、搜索、inspect、提示词、PTC 绑定只生成各自需要的扁平数据或文本。不存在 tree/manifest 或重建语义树的中间层。

discover 在当前会话快照上解析精确路径，只将显式查询的可用命令加入原生发现集合。syncNative 从原节点导出契约并注册工具，保留 DSH guard、父子审计、附加上下文和结束回合语义。物理工具作用域变化只改变可调用契约，不修改快照指针。
