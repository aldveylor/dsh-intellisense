# 命名空间模型

`service.ts` 的 ToolsNamespace 仅继承 ProfileCollection，并提供保存事件 effect；`component.ts` 实现具名 Profile 创建、读取、编辑和删除。get/edit 只接受目录名称，返回独立匿名快照；edit 原子发布回调返回的树。createInitialProfile 为无参数工厂，默认创建 RootNamespace。该服务不提供命令查询、执行、搜索引擎、统计、工具属性或命名空间实现注册。

节点路径解析属于 ProfileSnapshot.resolve(path)，只遍历快照内的节点，支持 global. 前缀并检查节点及祖先禁用状态。返回原始节点或 undefined，空路径返回快照自身，不查询工具目录、不调用工具、不统计 inspect 查询；无关的未绑定成员不影响目标解析。物理可用性和执行权限交给调用层及 DSH。

`tool_addition.ts` 独立定义物理工具附加属性，`definitions.ts` 管理可撤销的工具属性、命名空间实现、Profile 工厂和保存事件。builtin_profile.ts 直接通过定义注册内置工具契约，与 ToolsNamespace 的 Profile 目录 API 分离。ProfileSaveEffect 只通知提交后的 name/time/type，返回值不参与工具反馈；校验和提示由 tools/profile_save.ts 处理。

`namespace.ts` 将 ProfileSnapshot 与实际物理目录投影成 manifest，通过快照 resolve 取得命令名称，再生成绑定与别名。不可用命令保留 Profile 数据但不参与执行投影。`nodes/` 实现 NamespaceNode、CommandNode，Profile 编辑节点在 tools/profile_nodes/；权限由具体服务端节点执行。declaration.ts、prompt.ts 与 native_tools.ts 分别提供声明、呈现和原生名称适配。

Session.intellisense 持有 AgentSessionAddition，包含 profile: ProfileSnapshot、会话调用 statistics.increment([tool]) 和异步 save()（仅保存会话快照），不提供查询、执行或目录接口。inspect 查询统计保留在 tools/inspect.ts。会话快照持久化及内部配置投影位于 registry/profiles.ts；NamespaceIntegration 在 integration/namespace_integration.ts 内部管理作用域目录、搜索、发现、呈现和 DSH 派发，不作为 AgentSessionAddition 暴露。

plugin.ts 注册 toolsNamespace 和内部 namespaceIntegration 服务，挂载管理、恢复路由及生命周期。runtime.ts 仅在 PTC presentation 注册 tools_run_code，使用内部集成层编译绑定和派发；取消后等待真实子调用结束。统计实现在 ../statistics/，不属于 namespace；调用与物理工具查询分别持有独立计数集合，inspect 查询按 Profile 名称与路径单独累计。
