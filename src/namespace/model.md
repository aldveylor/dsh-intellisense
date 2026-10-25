# 命名空间模型

`namespace_plugin.ts` 装配共享 Profile、管理 UI、tools_intellisense、命名空间树和模式提示。主入口 index.ts 提供运行时配置；仅 PTC presentation 创建 codeRuntime 与 NamespaceRuntime；独立入口 ./namespace 不创建 JS 运行时。主插件和命名空间服务仅配置运行预算与别名；执行模式由 presentation 配置决定。

`namespace_runtime.ts` 注册插件自有的 tools_run_code，使用已有受限 RuntimeHost 执行完整 TS/JS 函数体，不依赖或替换部署的全局 ptcRuntime。只在 Intellisense PTC presentation 作用域挂载，模型仅见 tools_run_code；物理目录和 manifest 排除此入口，禁止递归调用。轨迹调用卡片使用 description 作为标题，以 TypeScript 代码块展示 code。初始化时将 CommandNode 编译为 CommandBinding，VM 内 NamespaceCommand 代理类把函数绑定到物理 tool 与参数/结果适配器；IPC 直接传物理 tool 和底层命名参数，宿主通过 namespace_component.dispatchTool 调用 DSH tools.execute，不逐次重建或解析 manifest，不增加插件权限校验。保留父子审计和附加上下文转发，返回值仅由 VM 命令适配器投影一次并保留 undefined。显式超时限制在部署上限内，按实际 Agent owner 释放状态。取消先解除 IPC 回调等待，再取消并等待所有真实子调用；程序结束时也取消并等待未完成子调用，避免循环等待和后台遗留执行。执行失败保留原始错误和已捕获输出，以 CodeRunFailedError 返回。插件不解析模型流或代码围栏。

`namespace_component.ts` 在 native 模式下按会话注册命名空间代理。代理使用命名参数，按 YAML argMap 转换字段；代理闭包持有已解析的 CommandNode，将参数转换后通过 DSH 原生执行流水线派发；权限交给 DSH，不再在调用时重建和查找 manifest。生成代理不进入物理工具目录，仅挂载 tools.intellisense、固定命令和会话已查询的直接成员，变更 manifest 后替换，释放会话或卸载时清理；不为无显式配置的会话创建默认呈现。PTC 模式仅向模型暴露 tools_run_code，native 模式仅暴露当前渐进发现集合中的命名空间工具。

`native_tools.ts` 为 native 代理生成符合 API 字符及 64 字符长度限制的名称，例如 tools.intellisense 对应 ns_tools__intellisense，std.cwd 对应 ns_std__cwd。挂载命令统一添加 ns_ 前缀，点号替换为双下划线；美元符号编码，长路径使用 ns_ 加 61 字符十六进制摘要，短名称碰撞添加数字后缀，超过长度限制时从完整路径和计数重新计算摘要，保留 ns_ 前缀并满足长度限制；每个基名独立保存冲突计数。内置管理代理派发到原始物理工具；代理名称避让物理工具名称。原生模式不额外生成 namespaces/tools JSON 目录，当前可调用名称由工具 schema 提供。Profile、IntelliSense 查询与 PTC 继续使用原路径。

管理目录异步汇总全局、可用预设的 standing scope 及活动会话工具，以物理名称去重；读取预设使用 acquireScope 并始终释放 lease，无需创建会话。损坏的预设不参与目录，会话运行时仍只读取实际调用者作用域的物理工具，不能从管理目录继承其他预设权限。

Profile 可同时保存来自多个预设的映射；当前模型作用域未挂载的物理工具不参与 effective/manifest，不影响其余映射，也不删除原始配置。后续挂载对应工具后原映射自动参与解析。

`node.ts` 定义共享 Node、Permission 与 SerializedNode。NodeType 只区分 leaf（命令）和 tree（命名空间），服务端子类身份不进入协议。Permission 包含 renamable、movable、removable、disableable、acceptsChildren、availableFixLevels；固定等级为 0/1/2。serialize/toJSON 仅输出子树、命令契约、描述和权限，不包含父引用。

`nodes/` 按类拆分实现，详见其 model.md。`namespace.ts` 作为上层入口，通过 createNamespace(context) 组织初始 console/tools 子树，再由 manifest 注册当前映射及别名。根是普通匿名 NamespaceNode，不存在 RootNamespaceNode。NamespaceNode.add 不覆盖已有成员；remove 由父节点检查子节点 permissions.removable。InnerNamespaceNode 自行限制外部插入；ToolsNamespaceNode、ProfileNamespaceNode、ConsoleNamespaceNode 在构造期间管理各自子对象，ToolsNamespaceNode 禁止禁用。

console 等环境接口是 EnvironmentCommandNode 普通 leaf，带环境声明并标记 deployment=environment；tools.* 使用服务端 InnerCommandNode 和专用命令节点，绑定 rest、重载、丢弃结果及预加载。tools.intellisense 的节点权限仅允许固定等级 2 且不可禁用。所有成员都在初始化时创建，intellisense 查询只调用 queryNodes → resolve，查询期间不生成节点、不覆盖映射。PTC 绑定仅选择 deployment=tool 且非 preload 的命令，console 等环境节点不编译为物理工具代理。

管理 API 将同一初始化树的 SerializedNode 传给客户端，客户端不导入内置命令表、不按 console/tools 等名称生成权限或节点。Profile.root 同样使用 SerializedNode 描述，导入时由服务端权威节点检查受保护子对象不可删除、替换或外部插入；不能通过伪造 permissions 改写这些规则。实际工具执行权限仍由 DSH 原生 guard 处理。

`prompt.ts` 根据 native/ptc 配置生成初始说明，PTC 渲染 Profile 选中的部分命名空间树。未知命令先直接查询 tools.intellisense；PTC 通过 tools_run_code 调用命名空间，native 直接使用 DSML 命名空间工具。native 初始提示与工具描述明确 {"queries":[""]} 接受空字符串以查询根命名空间；初始提示强调当前工具基于命名空间，ns_ 标记挂载命令，双下划线 __ 是调用名称中的命名空间分隔符，对应查询路径中的点号；不再附加根命名空间摘要和工具映射 JSON，描述只保留在工具 schema 中，不生成 TS/JS 声明或执行说明。

固定提示按命令等级生成：0 不输出，1 输出 Function 占位和 Profile 简略注释，2 输出完整签名与 @brief、@param、@returns 文档。详细工具文档沿用 IntelliSense 声明投影，参数别名与返回值解包规则相同；无参数命令不生成虚构 @param。tools.intellisense 强制固定等级 2，移除 setFixed 操作。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；不使用 console 专有存储字段。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

PTC 每次执行重建 VM Context，不保证环境连续，不支持 globalThis，不提供 vm 命名空间或 vm.restart。tools.profile.commands 使用完整管理目录，含当前上下文没有的命令；save 校验同一目录，但执行仍受调用者作用域权限控制。内置命令描述固定英文。整理入口创建未提交的新 PTC 对话草稿，不再调用维护子代理。

原生发现集合仅在 native 模式维护，最多保留最近查询的 256 个路径；同步时移除已失效路径。PTC 生命周期直接订阅 agent/disposed，运行时释放等待队列退出并移除进程、队列与 epoch。

`namespace_declaration.ts` 定义共享命名空间声明项与唯一树渲染器，负责路径合并、稳定排序、嵌套、简略 Function 占位、常量和完整声明，以及提示围栏转义。namespace.ts 仅投影工具契约；intellisense.ts 仅选择查询结果；prompt.ts 仅选择提示内容。三种入口统一使用该树模型，内置签名与重载也共用 builtinDeclaration。

`tools` 根命名空间不可禁用：共享 permissions.disableable 为 false，UI 不显示禁用按钮且回调不允许禁用；registry 拒绝将 tools 写入 builtinDisabled。tools 下其余命令和 tools.profile 仍保留各自禁用权限，tools.intellisense 始终可用。

