# 命名空间模型

`statistics.ts` 的 CommandStatistics 通过 `NamespaceComponent.statistics` 提供统计服务，管理 UI 通过状态接口读取全局 callsByTool，供工具卡片、详情浮层与排序使用。`dispatchTool` 每次派发前按物理 tool ID 计一次调用，包含失败派发，native 与 PTC 共用入口；原生物理工具调用、tools_run_code 外层执行、console 等环境接口和预加载数据读取不计入。`snapshot()` 返回全局统计，`snapshot(sessionId)` 返回指定会话统计；快照含 calls、namespacesQueried、commandsQueried 总数以及 callsByTool、namespaceQueriesByPath、commandQueriesByPath 明细。总数由明细求和，读取返回独立副本。

`tools/inspect.ts` 内部按请求中的实际查询目标计数：去掉 global. 前缀和命名空间尾点，根目录路径为 ""；重复目标分别计数，命名空间查询不展开为所有后代的查询次数。不存在、禁用、无效命令尾点不计数，非法路径请求整体拒绝。统计在一个同步步骤中原子累加目标会话、全局及物理工具查询计数；延时保存交给 storage/JournalStore，重启和会话释放均保留已保存计数。

`plugin.ts` 通过 `ctx.provide('toolsNamespace', component)` 注册共享服务，Context 类型声明、presentation 与运行时注入及调用方统一使用 `ctx.toolsNamespace`。该服务装配共享 Profile、管理 UI、tools_inspect、命名空间树和模式提示。主入口 index.ts 提供运行时配置；仅 PTC presentation 创建 codeRuntime 与 NamespaceRuntime；独立入口 ./namespace 不创建 JS 运行时。主插件和命名空间服务仅配置运行预算与别名；执行模式由 presentation 配置决定。

`runtime.ts` 注册插件自有的 tools_run_code，使用已有受限 RuntimeHost 执行完整 TS/JS 函数体，不依赖或替换部署的全局 ptcRuntime。只在 Intellisense PTC presentation 作用域挂载，模型仅见 tools_run_code；物理目录和 manifest 排除此入口，禁止递归调用。轨迹调用卡片使用 description 作为标题，以 TypeScript 代码块展示 code。初始化时将 CommandNode 编译为 CommandBinding，VM 内 NamespaceCommand 代理类把函数绑定到物理 tool 与参数/结果适配器；IPC 直接传物理 tool 和底层命名参数，宿主通过 NamespaceComponent.dispatchTool 调用 DSH tools.execute，不逐次重建或解析 manifest，不增加插件权限校验。保留父子审计和附加上下文转发，返回值仅由 VM 命令适配器投影一次并保留 undefined。显式超时限制在部署上限内，按实际 Agent owner 释放状态。取消先解除 IPC 回调等待，再取消并等待所有真实子调用；程序结束时也取消并等待未完成子调用，避免循环等待和后台遗留执行。执行失败保留原始错误和已捕获输出，以 CodeRunFailedError 返回。插件不解析模型流或代码围栏。

`component.ts` 在 native 模式下按会话注册命名空间代理。代理使用物理工具原始命名参数，不转换参数字段；代理闭包持有已解析的 CommandNode，将参数转换后通过 DSH 原生执行流水线派发；权限交给 DSH，不再在调用时重建和查找 manifest。生成代理不进入物理工具目录，仅挂载 tools.inspect、固定等级 2 的命令和会话已精确查询的函数，变更 manifest 后替换，释放会话或卸载时清理；不为无显式配置的会话创建默认呈现。PTC 模式仅向模型暴露 tools_run_code，native 模式仅暴露当前渐进发现集合中的命名空间工具。

`native_tools.ts` 为 native 代理生成符合 API 字符及 64 字符长度限制的名称，例如 tools.inspect 对应 ns_tools__inspect，std.cwd 对应 ns_std__cwd。挂载命令统一添加 ns_ 前缀，点号替换为双下划线；美元符号编码，长路径使用 ns_ 加 61 字符十六进制摘要，短名称碰撞添加数字后缀，超过长度限制时从完整路径和计数重新计算摘要，保留 ns_ 前缀并满足长度限制；每个基名独立保存冲突计数。内置管理代理派发到原始物理工具；代理名称避让物理工具名称。原生模式为固定等级 1 的命令及固定命名空间生成 JSON 提示目录，包含 path、可选 brief 与命名空间的 namespace: true，不包含参数 schema；保留所展示命令的父命名空间与描述。等级 1 不直接注册工具，精确查询后可进入会话发现集合；等级 2 直接注册工具，当前可调用名称由工具 schema 提供。Profile、Inspect 查询与 PTC 继续使用原路径。

管理目录异步汇总全局、可用预设的 standing scope 及活动会话工具，以物理名称去重；读取预设使用 acquireScope 并始终释放 lease，无需创建会话。损坏的预设不参与目录，会话运行时仍只读取实际调用者作用域的物理工具，不能从管理目录继承其他预设权限。

Profile 可同时保存来自多个预设的映射；当前模型作用域未挂载的物理工具不参与 effective/manifest，不影响其余映射，也不删除原始配置。后续挂载对应工具后原映射自动参与解析。

`node.ts` 定义共享 Node、Permission 与 SerializedNode。NodeType 只区分 leaf（命令）和 tree（命名空间），服务端子类身份不进入协议。Permission 包含 commentable、renamable、movable、removable、disableable、acceptsChildren、availableFixLevels；固定等级为 0/1/2。serialize/toJSON 仅输出子树、命令契约、描述和权限，不包含父引用。

`nodes/` 按类拆分实现，详见其 model.md。`namespace.ts` 作为上层入口，通过 createNamespace(context) 组织初始 tools 子树，再由 manifest 注册当前映射及别名。根是普通匿名 NamespaceNode，不存在 RootNamespaceNode。NamespaceNode.add 不覆盖已有成员；remove 由父节点检查子节点 permissions.removable。DefinedNamespaceNode 从递归接口数据构建已有子节点，再对外提供编辑权限。builtin_profile.ts 使用 toolsNamespace.edit 和节点接口显式安装 tools 子树及权限，替代专用 Tools/Profile/Inspect 节点类。tools 允许禁用，后代继承禁用状态。

tools.* 使用服务端 InnerCommandNode 和专用命令节点，绑定重载、丢弃结果及预加载。tools.inspect 的节点权限仅允许固定等级 2，但可禁用。所有成员都在初始化时创建，inspect 查询只调用 queryNodes → resolve，查询期间不生成节点、不覆盖映射。PTC 函数绑定仅选择非 preload 的命令；所有命令节点均绑定物理工具，不再区分 tool/environment 部署类型。

管理 API 将同一初始化树的 SerializedNode 传给客户端，客户端不导入内置命令表、不按 tools 等名称生成权限或节点。Profile.root 同样使用 SerializedNode 描述，保存时由服务端权威节点拒绝移除、替换、改名、移动、修改受保护文档或外部插入；不能通过伪造 permissions 改写这些规则。实际工具执行权限仍由 DSH 原生 guard 处理。

`prompt.ts` 根据 native/ptc 配置生成初始说明，PTC 渲染 Profile 选中的部分命名空间树，native 渲染简略固定项的 JSON 目录。初始说明仅保留命令发现入口、模式调用约定和通用运行时语义，不重复列举具体函数调用示例或 Profile API 的读取、切换、保存、删除及预加载字段用法；未知命令先直接查询 tools.inspect；PTC 通过 tools_run_code 调用命名空间，native 直接使用 DSML 命名空间工具。tools.inspect 的参数规则（queries 字符串数组参数、末尾点号、精确路径、global. 前缀与空字符串查询根命名空间）仅在 @param 中说明，函数摘要、执行入口描述与初始提示不重复强调，初始提示不附加查询结果为参考数据的宣示；初始提示强调当前工具基于命名空间，ns_ 标记挂载命令，双下划线 __ 是调用名称中的命名空间分隔符，对应查询路径中的点号；native 不附加完整根目录或工具映射，简略固定项使用 JSON，不生成 TS/JS 声明。

PTC 固定提示按命令等级生成：0 不输出，1 输出 Function 占位和 Profile 简略注释，2 输出完整签名与 @brief、@param 文档，不生成返回值文字注解；输出 schema 及返回类型中的 description 均移除，保留返回类型与字段名。详细工具文档沿用 Inspect 声明投影，参数别名与返回值解包规则相同；无参数命令不生成虚构 @param。tools.inspect 强制固定等级 2，移除 setFixed 操作。

固定 Profile 命令时不自动附加 Profile 数据模型声明；完整模型通过 tools.profile.annotation 按需读取。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；命令各自保留独立的提示等级。所有模式均不提供 console 命名空间及其命令、查询声明或管理节点；PTC 运行时原生 console 输出对象仍独立可用。

PTC 同一对话复用 VM Context，允许 globalThis 挂载变量跨调用共享；每次执行刷新命令与预加载值，VM 重启后状态丢失，不保证环境连续，不提供 vm 命名空间或 vm.restart。tools.profile.commands 使用完整管理目录，含当前上下文没有的命令；每项包含 name、brief 和 totalCalls（全局按物理工具 ID 累计的调用次数，包含失败派发，未调用为 0）。PTC 构建 VM 时由 values 读取一次统计快照并预加载为冻结数据，不在执行期间刷新；native 数据工具读取相同结构。save 校验同一目录，但执行仍受调用者作用域权限控制。内置命令描述固定英文。整理入口创建未提交的新 PTC 对话草稿，不再调用维护子代理。

原生发现集合仅在 native 模式维护，仅由精确函数查询扩展（命名空间查询只列举成员），最多保留最近精确查询的 256 个命令路径；同步时移除已失效路径。PTC 生命周期直接订阅 agent/disposed，运行时释放等待队列退出并移除进程、队列与 epoch。

`declaration.ts` 定义共享命名空间声明项与唯一树渲染器，负责路径合并、稳定排序、嵌套、简略 Function 占位、常量和完整声明，以及提示围栏转义。namespace.ts 仅投影工具契约；inspect.ts 仅选择查询结果；prompt.ts 仅选择提示内容。三种入口统一使用该树模型，内置签名与重载也共用 builtinDeclaration。

常量与对象成员通过前置 Doxygen JSDoc 保留描述；tools.profile 因含 delete/switch 使用对象声明时，annotation、commands、profiles 等字段仍提供注释，单独查询字段同样保留。

`tools` 根命名空间与 `tools.inspect` 均可禁用，按 Profile 保存 builtinDisabled；禁用 tools 时所有子节点继承禁用。运行时绑定、原生工具集合与固定提示排除禁用节点；发现入口未注册或禁用时，初始执行说明、目录指引和内置命令说明移除 tools.inspect 提示。


命名空间描述由 manifest 从 Profile namespaces 元数据传入普通 NamespaceNode，内置 tools 等命名空间保留自身描述。native 成员查询的命名空间条目包含 brief，所有条目的 brief 为空或仅含空白时省略该键；PTC 查询与初始提示词为已展示的命名空间及其父链附加 description 注释，包含 tools.inspect 的 tools 父命名空间；不因此展开未查询或未固定的其它成员。

`NamespaceComponent.profileNames` 合并全局目录名称和当前会话选中配置，供 native 的 tools.profile.profiles 命令与 PTC 的同名只读字段使用；PTC 每次执行前及工具成功回复时刷新。

`component.ts` 在 Profile 首次初始化时通过 AgentRegistry.isOwnedBy 查询运行时父 Agent；父作用域启用 Intellisense 时，递归取得其工作配置供子会话复制，后续按各自 ID 持有独立快照。无启用本插件的父 Agent 则使用全局默认；已加载或已持久化的子会话配置优先，不因再次查询、父配置切换或恢复而覆盖。

当前对话通过显式 switch(name) 或会话 Profile 下拉框更新工作配置后，统一由 configurationChanged 刷新工具提示。仅 tools.profile.switch(name) 成功完成加载和刷新后，通过 Agent.inject 向当前对话注入 intellisense-profile 英文 notice：`Profile updated to <profile name>`；load(name)、UI 下拉选择、通用配置刷新、保存目录、读取草稿、失败操作及删除其它配置均不注入。

manifest 保留物理工具原始注释，精确 Inspect 函数查询（含 YAML 别名）显示原始完整注释；命名空间成员列表、固定提示（包括等级 2 的声明）与 native 工具描述优先采用当前挂载路径的 Profile command.doc 简化注释，其次采用 toolComments 工具注释，无偏好时回退到原始注释首行。native 精确查询通过 description 返回原始完整注释，brief 保留简化摘要。命令目录仅排除明确保留的插件工具 ID，不按 tools_ 前缀排除外部工具。目录中未挂载的命令可直接按物理名称构建 Profile 叶子，实际执行仍要求当前作用域存在对应物理工具。

挂载路径无主次之分，各路径的固定等级、禁用状态与简化描述独立生效。commands.paths 从会话 Profile 配置汇总挂载路径，包含禁用路径与已挂载工具的 YAML 配置路径；不从过滤禁用项的执行 manifest 推导。

命名参数与声明直接使用物理工具原始字段，不支持参数别名。目录按 tools/change 及会话生命周期失效，重复读取复用目录；单次原生同步共享 registry 和 manifest，有效映射按路径索引。统计只增量修改目标会话和全局计数，不从所有会话重新计算全局统计。command_statistics 保存全局计数及物理工具查询计数，command_statistics_session_<hash> 分别保存会话计数。CommandStatistics 仅负责计数、脏会话集合及延时调度；日志绑定、提交、幂等重放与失败事务重试由 storage/journal_store.ts 的 JournalStore 统一实现。一次提交只覆盖脏会话及全局记录，不复制或保存其它历史会话。默认 setTimeout 延迟 30000ms，保留唯一句柄，新增计数不推迟既有截止时间；无脏标记时不写入。普通工具派发不等待磁盘保存，snapshot 返回含未落盘增量的独立内存快照；flush 显式落盘，dispose 取消定时器并刷新后才关闭存储。写入失败保留内存计数和脏标记，通知错误并定时重试，不回滚已经执行的工具。进程异常退出可能丢失尚未提交日志的延迟窗口内计数。统计带统一模型版本；旧版本逐项验证保留可加载部分，丢弃失败项并重写版本；旧 sessions 单记录仅在转换时聚合一次全局计数，新结构启动直接读取全局记录。

原生同步以 registry.generation 和已发现路径集标识输入；配置、物理契约及发现集合未变时直接复用已注册工具名称，跳过 manifest 和注册指纹构建。物理目录内容未变时不重新克隆工具 schema。

全局 queriesByTool 按查询时解析出的物理工具 ID 累计精确命令查询次数，不按当前 Profile 反推历史归属；同一工具的不同别名共享计数，仅在全局快照提供，会话快照该字段为空。全局和脏会话记录通过绑定 command_statistics 前缀的 JournalStore 形成可恢复逻辑原子事务，重启后恢复。命名空间继续使用全局 namespaceQueriesByPath，成员查询不增加子命令查询数。

`component.ts` 从最近 presentation 配置读取可选固定 profile；会话初始化时优先复制指定目录配置，读取时将不同名称的已有工作快照切换到指定 Profile，同名草稿保持独立。

native 模式在 tools.inspect 不可用（自身禁用、tools 祖先禁用或未注册）时完全移除 namespaces:execution 提示段，包括 DSML 调用和 ns_/__ 命名约定，保留实际工具 schema；恢复 inspect 后重新生成发现说明。PTC 仍保留运行代码和 VM 语义，仅移除 inspect 指引。

插件在加载持久化配置失败时保留管理路由，GET 返回错误供 UI 展示加载错误叠层；重置接口仅恢复无法加载的数据部分，成功后再初始化命名空间服务及会话事件，不要求手动删除存档。

会话 registryFor 按 Agent 对象弱引用缓存已同步的物理目录来源；工具服务、tools/change/会话生命周期版本、registry 实例或 scopeChainOf 祖先链变化时才重新投影并刷新目录，未变时跳过 schemas 的深复制及 registry.refresh 的全量序列化。作用域重新绑定不要求额外工具事件也能失效；不同 Agent 不共享来源缓存。固定 Profile 名称比较通过 profileSelection 读取，不复制配置树。

NamespaceComponent 的作用域释放会 dispose 统计服务，确保独立挂载组件（不通过主插件）也在释放时取消计时器并刷新脏计数；主插件仍在关闭 KV unit 前执行最后刷新。重复 dispose 为无脏状态操作。

PTC 预加载通过 values 先按当前 Profile 的禁用规则过滤，再计算字段。子调用回复只刷新本次初始化已部署的字段，commands 仅在 revision 变化时计算；执行中切换到禁用字段的 Profile 仍刷新已有引用，新一次执行不再部署禁用字段。

统计 counterSnapshot(field, session?) 返回指定字段的独立副本，不复制其它明细或汇总总数；命令摘要使用该接口读取全局 callsByTool。

服务注册名为 toolsNamespace；工具调用路径仍为 tools.*。命令的结构锁定与提示固定独立：Mapping.pinned 阻止移除或改变原映射路径；普通命令的提示等级由 Mapping.alwaysVisible 保存，内置命令由 builtinVisible[path] 保存。InnerCommandNode 通过 permissions 禁止改名、编辑说明、移动和移除，普通固定等级仍可选 0/1/2；内置注册通过节点接口将 tools.inspect 的 availableFixLevels 限为 [2]，因此即使 Profile 请求 0 或 1 也投影为 2，禁用状态仍独立生效。

service.ts 定义 ToolsNamespace interface，NamespaceComponent 实现该接口并继承 ProfileCollection 的 get/create/getOrCreate/edit 合约。Profile 是无名称的匿名树 snapshot，初始为空；edit(name, modifier) 原子发布回调返回值，普通 snapshot 编辑不落盘。Profile 节点接口与内部 class 实现在 registry/profile/。

ToolAddition 定义 fixed、hidden、ptcDescription 可选属性。fixed 禁止人工及 agent 新增挂载，插件 edit 可显式挂载；hidden 从目录、选择器和发现中排除，PTC 仍独立暴露 tools_run_code。native 采用物理工具原始说明，PTC 优先使用 ptcDescription。definitions.ts 统一管理属性注册及注销，builtin_profile.ts 通过相同注册接口配置内置工具；加载尚未显式物化的内置树时通过 edit 安装，之后以实际提交树为准。
