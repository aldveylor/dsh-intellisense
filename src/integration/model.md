# 集成模型

presentation.ts 按作用域选择 native/PTC，均通过 DSH native 工具执行。PTC 在自己的作用域创建 namespaceRuntime/codeRuntime，不替换全局后端。profile 配置可锁定初始化名称；已开始的同名会话仍保留原快照版本。没有显式 presentation 的会话不启用此插件。

ctx.intellisense 包含 profiles（同 ctx.toolsNamespace）、toolAdditions、statistics、inspectStatistics、searchEngines。toolAdditions 位于 tool_additions/，只保存独立工具元数据；内置固定身份、契约与预加载行为由实际 Profile 函数类实现。

agent_session_addition.ts 公开只读 name、profile: ProfileReference、会话统计和 save()。profile.pointer 是全局递增版本号，profile.snapshot 返回独立值，不能借此修改会话版本。save() 只保存引用。会话初始化、父子继承、恢复和显式 switch 由 ProfileSessions 负责，不生成内部会话 registry。

NamespaceIntegration 构造时分别接收 ToolsNamespace 服务接口、ToolCatalog 物理目录接口与 ProfileSessionCollection；具名数据与默认选择经 ToolsNamespace，物理目录接口不含 Profile 操作，不导入 NamespaceComponent，也不通过 namespace.registry 访问具体服务内部。intellisense.profiles 保留传入服务的接口身份。

NamespaceIntegration 是工具作用域、发现集合、请求位置和代理生命周期的内部编排层。get/entries 直接消费引用对应的 ProfileSnapshot 及其原节点；原生工具、搜索、inspect、提示词、PTC 绑定只生成各自需要的扁平数据或文本。不存在 tree/manifest 或重建语义树的中间层。

discover 在当前会话快照上解析精确路径，只将显式查询的可用命令加入原生发现集合。syncNative 从原节点导出契约并注册工具，保留 DSH guard、父子审计、附加上下文和结束回合语义。物理工具作用域变化只改变可调用契约，不修改快照指针。

原生代理通过 dispatchTool 保留物理工具的完整返回值，与输出 schema 和 presentResult 的输入结构一致；单字段解包和 discardResult 仅用于 PTC 返回值投影。

plugin.ts 是命名空间执行集成装配入口，依赖已挂载的 toolsNamespace 和 共享存储基础设施，不创建或发布 Profile 服务。默认根入口先挂载 profile/plugin.ts，再挂载 integration/plugin.ts。ProfileSessionCollection 隔离会话实现；Profile 服务存储的关闭晚于集成层统计刷新。

tool_catalog.ts 的 PhysicalToolCatalog 单独拥有物理工具契约与 ToolAdditions，不持有 Profile 存储或目录。plugin.ts 只消费 toolsNamespace 接口以及内部 intellisenseStorage；不存在额外的 profileBackend 业务入口。ctx.intellisense 保持独立，profiles 仅保留对 toolsNamespace 的同一对象引用。

DSH 0.2.2-alpha.2 将批次执行交给 ToolExecutor。register 在 presentation 的 Agent 或 preset 作用域通过 ../compatibility/compatibility.ts 的 configureTools 安装 NativeToolExecutor 代理，后续绑定该作用域的会话直接继承执行器，无需依赖会话 configure 安装过滤。native 模式只声明 syncNative 标记的工具定义，PTC 模式只声明 tools_run_code；物理工具仍留在内部目录供命名空间子调用使用。工具声明由执行器 describe 生成；system-prompt/assemble 仅修改文本，不修改工具声明。执行器与 presentation 同生命周期，会话 release 仅撤销会话代理及缓存。

presentation 挂载完成（包括 PTC runtime 注册）后，通过 configureScope 初始化该作用域及子作用域已有会话的 Profile/native 工具；尚未发布的会话由 agent/created 初始化。agent-preset/selected 标记该次预设选择是否发生在首轮开始前，并启动初始化；每次提交的选择事件均构成新的绑定边界，即使预设名称相同。configure 按 Agent 串行执行，首次启用或预设重绑时，空白根会话将当前名称切到全局最新指针，名称已删除则回退到全局默认名称。首次父子继承保持父指针；已开始会话保留快照；普通工具解析及全局保存不刷新引用。预设变化清除旧发现集合，离开 native 模式撤销会话代理。

旧版 DSH 通过兼容层 presentNative 声明 native 作用域，并在 system-prompt/assemble 选择 assembly.tools；不加载新版执行器，也不修改新版真实轮次捕获后的工具集合。

session_initialization.ts 为 DSH 0.2.2-alpha.2 缺少可等待的预设重绑/工具解析前事件提供生命周期适配：在 tools.resolve 捕获本轮工具集合前等待 configure，在不携带 toolSet 的 systemPrompt.assemble 预览前执行相同初始化。适配保留调用方服务上下文，继续委托原方法，卸载时恢复原方法描述符，不更换执行器或修改工具声明结果。真实轮次在捕获 toolSet 后不再从 assemble waterfall 注册代理，保证首次模型请求与执行准入集合一致。已有 preset 晚于会话创建绑定时，native/PTC 均无需用户点击 Profile 或由界面先请求配置。

命名空间子调用通过兼容层 dispatchTool 执行，传播父调用 token、rootCallId、toolSet 和 signal；新版使用 prepare/dispatch/complete，旧版使用单次 tools.execute。业务层保留配对子调用事件、结构化错误和包括 false 在内的 meta，返回上下文和结束回合标志继续传递到父调用。
