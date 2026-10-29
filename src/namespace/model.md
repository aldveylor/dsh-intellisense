# 命名空间模型

`service.ts` 定义不依赖 Agent 的 ToolsNamespace，`component.ts` 实现共享 Profile 目录与命令名称解析。ProfileCollection 提供 list/get/create/getOrCreate/remove/edit；get 和 edit 只接受目录名称，返回独立匿名快照。edit 原子发布回调返回的树，Profile 编辑接口不直接调用工具。createInitialProfile 为无参数工厂，默认创建 RootNamespace；具体类型和权限由节点实现保持。

`resolve(path, profile?)` 将启用的命令路径解析为物理工具名称；省略 Profile 使用当前全局选择，支持 global. 前缀。不存在的 Profile、命名空间、禁用及不可用命令返回 undefined。解析不执行工具、不修改选择、不登记发现状态。会话、呈现、审计和派发由 `../integration/agent_session_addition.ts` 的 AgentSessionAddition 处理。

`definitions.ts` 管理可撤销的 ToolAddition、命名空间实现、Profile 工厂和保存事件。fixed 禁止外部新增挂载，hidden 排除目录和发现，ptcDescription 覆盖 PTC 说明；project 投影契约，value 生产只读预加载值，只接收命名空间服务和当前 registry。builtin_profile.ts 通过统一接口注册内置定义。`setNamespaceImplementation` 扩展执行投影，不替代 Profile 节点权限实现。

`namespace.ts` 从当前 registry、Profile 和别名创建确定性的 manifest。不可用映射保留配置但不参与投影；别名仅为已经挂载的物理工具提供额外路径。`nodes/` 实现匿名 NamespaceNode、CommandNode 和执行投影，Profile 编辑节点在 `../tools/profile_nodes/`。命令绑定包含物理名称及参数/结果适配器，节点自身不执行工具。`node.ts` 提供共享 Permission 和无父引用的 SerializedNode，权限由服务端具体节点执行。

`declaration.ts` 统一渲染声明，`prompt.ts` 生成 native/PTC 说明与固定目录，`native_tools.ts` 负责渐进发现和 ns_ 调用名称映射。具体会话状态由集成层持有。

`statistics.ts` 增量维护全局、会话、物理工具计数，通过 JournalStore 延迟批量保存；读取返回独立副本，释放时刷新。管理目录刷新由集成层汇总全局、预设及活动会话作用域，运行时目录只使用当前 Agent 的实际工具。

`plugin.ts` 注册 toolsNamespace 和 agentSessionAddition 两个服务，挂载管理路由及 Agent 生命周期。存储加载失败时保留恢复管理入口。`runtime.ts` 仅在 PTC presentation 中注册 tools_run_code，通过 AgentSessionAddition 获取绑定和派发工具，隔离运行时取消后等待真实子调用结束。
