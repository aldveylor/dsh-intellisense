# 工具模型

内置工具在 presentation 作用域注册，inspect 直接读取 agent.session.intellisense.profile 当前会话快照。命名空间实现位于 `../profile/namespace/`，搜索引擎实现在 `../search/`。

`tools_inspect` 在 native/PTC 模式共享命名空间成员范围，不再按环境节点过滤结果；两种模式均无 console 命名空间。native 返回 JSON，PTC 返回 TypeScript 声明。

`inspect.ts` 注册 tools_inspect，固定映射 tools.inspect。工具结果卡片使用代码块展示输入/输出 schema 和查询结果（PTC 为 TypeScript，native 为 JSON，错误为 text），原生命名空间代理沿用此展示及输出 schema。物理工具及 native 代理保留 { queries: string[] } 命名参数；PTC 接口为 function inspect(queries: string[]): Promise<string>，接收单个字符串数组，tools.inspect([""]) 查询根命名空间，派发时使用通用字段适配器生成物理工具的 queries 字段。两种模式查询时均忽略开头的 global. 前缀，global. 等同于根目录查询。尾点查询列出直接子项，精确路径展开签名和文档，PTC 多查询合并为 TypeScript global 命名空间树；命名空间成员查询仅显示命令的 Profile 简略注释（未配置时取原始文档首行），只有精确函数查询显示完整注释和签名。native 返回 JSON 直接成员列表，实际工具条目省略 description 和 tool 字段，增加 brief 简化注释（优先使用 Profile 简略注释，未配置时取原始文档首行）；精确查询仍附带命名参数 schema；仅精确函数路径查询将对应命令加入系统提示词工具集合，命名空间查询只列举成员，不挂载其中的命令。native 查询会更新会话发现集合、同步工具并发出 system-prompt/change，使下一次组装包含新增工具。结果作为普通工具响应进入原生历史，并保存查询审计。会话释放时清除发现集合。

`tool_commands.ts` 注册 Profile load/save/apply/remove/switch/setdefault/annotation/commands/profiles。save 支持显式名称或当前会话名称，验证递归树与物理命令身份，仅发布目录，保留当前会话配置和选择，显式 switch(name) 后应用保存的配置；load 无名称只返回当前会话不可变快照，有名称只从全局目录读取指定配置并返回可序列化的 Profile 数据，不替换会话快照、不刷新工具提示。`../profile/namespace/runtime.ts` 将 annotation 和原始命令列表作为数据传给 VM init，不安装同名函数。

Profile load/save/annotation 统一使用继承 ProfileNode 的 CommandNode（type: command）与 NamespaceTreeNode（type: namespace）；节点不含 name，命名空间 children 使用名称为键的 Record；apply 对 children 按键递归合并，null 删除对应成员。基类 fixedLevel 为可选 number，具体节点限制支持的等级。Profile 数据模型声明通过 tools.profile.annotation 按需读取；tools_inspect 查询结果不自动附加这些声明。

`builtin_trace.ts` 在 presentation 作用域包装内置工具注册，保存实际参数/输出 schema、调用参数、返回值、错误与耗时到独立插件审计。结果保持原始模型内容，字符串结果不再额外 JSON 编码。审计和 Profile annotation 通过调用者上下文的 get() 获取命名空间服务，不要求调用者插件显式注入内部 namespaceIntegration。

`inspect.ts` 在物理 tools_inspect 执行内使用 inspectQueryTargets 解析有效目标；native/PTC 共享计数口径。inspectStatistics 按当前 Profile 名称累计路径查询，跨会话共享，同名路径在不同 Profile 中隔离；命名空间成员查询只计目标路径，精确命令查询计命令路径，重复参数分别累计。命令查询同时按物理工具名计入独立的 CommandStatistics.queries，别名共享工具计数。底层 Statistics 仅提供 increment/snapshot/scope，不定义调用或查询行为。

`tool_search.ts` 将 tools_search 注册到 presentation 作用域并映射 tools.search。搜索参数直接由 SearchEngineRegistry.selector 生成；引擎注册、卸载或默认方法变更后重新注册工具并通知提示重组。searchEngines 由内部 NamespaceIntegration 持有，与 ToolsNamespace 的 Profile 目录分离；主插件和 namespace 独立入口均接受 defaultSearchMethod。搜索只返回当前有效树中的完整命令路径，提示使用 tools.inspect 获取详细信息。声明、PTC 位置参数和 UI 提示共同读取实际物理 schema 中的方法枚举。

tools.profile.commands 返回排除插件内置命令的完整命令目录，字段为 name、brief、paths、totalCalls；paths 来自当前会话 Profile 配置的挂载路径，包含被禁用的路径（含祖先禁用）、当前作用域不可用的配置路径及已挂载工具的 YAML 配置路径，未挂载时为空数组；totalCalls 读取独立命令调用统计，供 AI 整理 Profile 时判断调用频率。运行时提示不描述统计更新时机。 commands 提示明确说明 tools.inspect 无法按原始物理命令名获取信息，应查询当前会话可用且启用的挂载路径。

PTC 在每次执行前预加载 commands，并由 VM 命令包装同步更新本次执行内对应物理工具的 totalCalls，只更新 VM 视图，不额外通知宿主。native 的 tools.profile.commands 是实际工具函数，每次调用均重新读取 CommandStatistics.calls 全局快照，返回该次读取时的最新累计值，不复用上次返回的数组。

命名空间成员同样保留注释：native 命名空间条目返回 brief；PTC 对直接命中的命名空间、显式查询的命名空间及返回成员的父命名空间链输出描述注释。Profile 自定义描述与内置 tools 等节点描述均从当前会话 Profile 节点读取。

`tools.profile.profiles` 返回 `Profiles { profiles: string[]; selected: string }`，列表来自全局目录，selected 来自当前会话。native 为无参数命令，每次调用读取最新状态；PTC 为只读字段，每次执行前初始化，并在工具调用成功返回前通过 IPC 刷新，load/save 后同次执行内的读取和持有的对象引用均可见新状态。

Profile save 的 name 省略或为 undefined 时，始终覆盖当前会话选择对应的目录项，写入树禁止包含 name；save 不替换当前会话快照、不切换选择，也不刷新工具提示或注入配置更新通知；创建新目录项必须传入显式字符串名称。支持 save(profileWrite) 和 save(name, profile)，缺少 Profile、非法名称类型或非法树均抛错；写入失败透传异常。native schema 与 PTC 声明同步说明权限违规抛错、受保护树必须完整保留、默认禁用及显式 switch 规则。

`tools.profile.remove(name: string)` 删除全局目录中的指定配置；必须显式指定目标名称，省略或传入 undefined 时拒绝调用，删除当前会话配置一律拒绝。其它会话已有快照保留，成功删除后 PTC 的 profiles 字段随工具回复刷新。

`tools.profile.switch(name: string)` 显式切换当前会话配置，必须指定已有名称；可通过 builtinDisabled 禁用，使用普通内置命令的 disableable 权限。load(name?) 只读取配置数据，不切换当前会话；省略名称读取会话草稿，指定名称读取目录中的配置。

当前对话通过显式 switch(name) 或会话 Profile 下拉框更新工作配置后，统一由 configurationChanged 刷新工具提示。仅 tools.profile.switch(name) 成功完成加载和刷新后，通过 Agent.inject 向当前对话注入 intellisense-profile 英文 notice：`Profile updated to <profile name>`；load(name)、UI 下拉选择、通用配置刷新、保存目录、读取草稿、失败操作及删除其它配置均不注入。

save 使用目标目录配置作为受保护节点文档及锁定等级的校验基线，不存在该名称时使用会话配置。内置成员缺失、绑定、说明及必需固定值由具体节点的 save 目标修正规则修复，受限命名空间额外插入等违规变更抛错；普通命令树比较目标后通过 apply 差异修正。

`tools.profile.setdefault(name: string)` 将已有目录配置设为全局默认 Profile，复用管理界面的默认配置选择事务并持久化；新建根会话使用该默认配置，已有会话工作快照保持不变，不刷新当前会话工具或注入配置切换通知。native 与 PTC 均可调用，支持通过 builtinDisabled 禁用。

Profile 读取节点 permissions 为可选的服务端只读权限差异项（save/apply 禁止提交）：commentable/renamable/movable/removable/disableable 默认 true，acceptsChildren 在命令为 false、命名空间为 true，availableFixLevels 在命令为 [0,1,2]、命名空间为 [0,1]。省略对象或字段均使用默认权限，受保护节点权限仍由服务端校验。Agent 读取投影递归省略默认权限字段、空 permissions、fixedLevel=0 和 disabled=false；load 与 annotation/JSON Schema 同步说明默认值。提交节点省略 fixedLevel/disabled 时通常使用 0/false；tools.profile.save 对 tools 命名空间缺省使用 disabled=true。agent 保存时缺失的内置节点由具体节点的 save 目标修正规则恢复。

Inspect 声明渲染仅接收查询、命名空间树、运行时模式与简略注释查询；禁用状态由节点的 disabled 属性提供，queryNodes 过滤禁用目标与成员，显式保留空命名空间时同样检查节点禁用状态，不再向渲染函数传入独立的路径禁用回调。

配置了 presentation.config.profile 的会话禁止 tools.profile.switch 切换配置，返回 session_profile_locked；读取与目录保存不受影响。

Profile save 比较完整目标并应用差异时，tools 仍为受保护命名空间，但默认禁用：省略 tools 的 disabled 字段时写入 builtinDisabled，显式 disabled: false 时启用；不切换或修改当前会话。其它合法设置保留，agent 保存时缺失的内置节点由具体节点的 save 目标修正规则恢复。save 的原生说明与 PTC 声明同步描述该规则。annotation 与 JSON Schema 说明禁用节点及后代从发现、运行时绑定、原生工具、预加载值和固定提示中排除，保留配置以供重新启用；禁用 tools 时移除 tools.inspect 指引。

`profile_save.ts` 根据保存后 Profile 生成非阻断信息。save 返回 string | null，null 表示成功且无信息；inspect 不可用且存在启用命令未固定等级 2 时返回建议字符串。禁用节点及后代不参与检查；建议不阻止保存、不改变固定等级。缺失内置成员由具体节点的 save 目标修正规则修复，拒绝不允许的额外成员；失败不落盘。

内置命令的功能说明与参数注释统一定义于 `runtime/builtins.ts`（源码根目录下）的 `PluginCommands` 契约表；原生注册、Inspect、固定提示及管理 UI 引用同一来源。BuiltinTool 保存共享或按 native/PTC 区分的描述、参数注释与 discoveryHint，通过 projectBuiltin(command, mode) 投影为纯字符串注释的 BuiltinCommand；原生注册按 presentation 作用域选择模式，会话命名空间按当前执行模式选择，管理目录默认使用 PTC 投影。依赖 inspect 的可选指引由投影后的 discoveryHint 标记，禁用发现时按该标记移除。

`tools.profile.apply(value: ProfilePatch)` / `apply(name: string | undefined, value: ProfilePatch)` 读取目标名称在全局表中的最新版本，递归合并部分对象 patch 后复用 save 的验证及持久化流程。未提交字段保留，null 删除对象字段，children 对象按成员名递归合并，数组整体替换，不按索引合并。合并结果必须满足 ProfileSchema；受保护节点继续按 save 规则校验，违规修改抛错，返回相同的 string | null 信息。显式名称必须已存在；省略名称读取当前选择名称在全局表中的最新版本并保存到该名称。保存不更改会话工作快照或选择，不刷新提示，应用仍需显式 switch。`profile_save.ts` 提供对象 patch 合并及保存信息生成。

apply 不使用 save 对 tools 的默认禁用规则：未提交禁用字段时保留 tools 及其内部命名空间、命令的原状态，显式 disabled 仍可切换状态，null 删除字段后使用节点默认值 false。save 的整树替换默认规则保持不变。

Profile 成员键必须为非空标识符，不能以 $ 或 __ 开头；禁止 Object.prototype 自有名称、prototype、then 等 JS 约定键。children 在 record 解析前校验，显式拒绝 JSON __proto__；apply 在合并前校验所有 patch 键，包括 null 删除项。普通路径继续使用 validatePath 校验运行时全局和语言保留名。普通命名空间可在其它路径使用与受保护成员相同的名称（如 inspect、profile、save）；仅禁止在受保护对象原路径覆盖或替换该对象，原位置的受保护命令不能替换为命名空间。

apply 的命令说明明确改名或移动普通挂载时，需要将原 children 键设为 null 并新增目标键；仅新增键会保留两个挂载。save 和 apply 共用校验，失败不写入目录或改变会话草稿。


Profile 写入模型使用 `profile/catalog/profile_write.ts` 的 ProfileWrite（从 ProfileData 排除 name，递归排除 permissions），apply 使用递归 Partial 的 ProfilePatch。permissions 仅作为 load 的服务端只读规则返回；save/apply 对 name、permissions、未知字段（含 null 删除）强校验并抛错。调用方从 load 数据显式投影为写入树，宿主可使用 profileWrite；annotation 提供读取与写入两套类型，native annotation 返回写入 JSON Schema。null 仅删除可选字段或 children 成员，删除必填字段直接报告 null 输入。save/apply 仍只写目录，commands.paths 继续指向当前会话，验证保存结果用 load(name)，显式 switch 后才更新会话路径。

`src/error.ts` 定义 ValidationError、ProfilePermissionError、ProfileNotFoundError、ToolCallError 和 PositionalArgumentError。normalizeError 尝试将原生 ZodError 转换为 src/error.ts 自定义 ZodError，使用 ErrorData/ErrorIssue 结构与 type、path/message 紧凑 JSON；不判断长度、不修改原错误，转换不适用或失败时返回原错误；guest 的位置参数错误为带 toolName/code 的 ToolCallError 子类，服务端错误码随 IPC 回复传递。


ProfileRootWrite 的匿名根只允许 type/children，拒绝没有持久化表示的根级 disabled、fixedLevel、description（包括 apply 的 null 删除）；普通成员仍使用 NamespaceWrite/CommandWrite。ConversationRequiredError、ProfileLockedError、CurrentProfileDeletionError 与 UnknownCommandError 在 src/error.ts 定义，不再用普通 Error 或权限错误表达这些 Profile 失败；非法 patch 键使用 ValidationError。


`profile_lock.ts` 的 ProfileLock 为当前命名空间组件提供共享 FIFO 异步互斥锁。所有 `tools.profile.*` 操作共用该锁，读写均在获取锁后执行；apply 的读取、合并、校验及目录持久化位于同一临界区，避免跨会话并发增量保存丢失更新。等待结束后再次检查取消信号，失败或取消通过 finally 释放锁，不阻塞后续操作。锁只协调本组件的 Profile 工具调用，不提供跨进程或绕过工具接口的存储事务。

工具附加属性由 ctx.intellisense.toolAdditions 提供 hidden 与 ptcDescription。固定身份来自节点权限，内置契约和预加载由命令类实现；ToolsNamespace 不处理 ToolAddition。插件侧编辑使用 toolsNamespace.edit(name, snapshot => snapshot)，仅更新全局版本。

工具直接读取当前会话引用的原始 Profile 节点，输出契约为携带原节点引用的扁平数据。permissions 保留为只读说明，检查与修正在 RootNamespace 和各子节点中执行。

Profile 操作模型详见 profile/model.md 与 tools/profile_nodes/model.md。ProfileCollection.createInitialProfile 是无参数初始生成函数；节点 create/getOrCreate 使用 (name, factory: () => T)，T extends ProfileNode，返回 T；get/set 使用 ProfileNode，type 基础声明为 string。Agent 的 apply 遍历增量字段，save 比较完整目标再遍历差异；节点仅提供成员操作和字段 setter，普通省略节点删除。`on` 仅通知保存事件，不处理返回值。

`profile_save.ts` 为 tools_profile_save/tools_profile_apply 统一执行节点校验、原子持久化及校验提示计算。ProfileSaveEffect 只在提交后观察 name/time/type，不处理返回值，不覆盖工具反馈；处理器可在保存事务结束后继续编辑目录。

Inspect 的查询目标及计数直接通过 ProfileReference.snapshot.resolve(path) 读取实际节点，原节点提供简述与命名空间描述，物理目录补充当前可用工具的文档、签名和 schema。不构建展示树或运行时语义树。

save/apply 只更新全局表并分配新版本号；当前会话快照不可修改。switch(name) 在共享锁内检查目标指针是否归档，已有则复用，否则首次复制后持久化当前会话指针。同指针并发进入只写入一次，switch 不生成新版本号。

Agent 的读取由 profile_data.ts 遍历 ProfileVersion.snapshot 的节点接口生成 JSON；写入由 profile_save.ts 在 ToolsNamespace.edit 中读取最新节点树，save 比较 normalize 后的完整目标，apply 使用增量字段，统一交给 profile/edit.ts 遍历调用增删与 setter。ProfileNode 与 Profile 均不提供 apply/save。发布、缺失目标初始化及保存事件由同一服务处理，不直接访问目录、扁平配置或 definitions。
