# 源码模型

包名为 @aldveylor/dsh-intellisense，组件显示名称由 根目录 locale/ 中的元数据定义，不包含 npm scope；包入口引用、客户端模块 ID 与 bundle 配置页注册键使用完整包名。默认入口 index.ts 组合命名空间服务与受限运行时，不注册 agent 预设，也不依赖 agentPresets 服务。独立的 ./preset 入口提供 Intellisense Preset 组件，配置项 ID 为 intellisense/preset，仅加载、校验、注册及卸载 Intellisense PTC（intellisense-ptc，TS/JS 执行）和 Intellisense（intellisense，原生 DSML 执行）两个 agent 预设；命名空间服务仍由主入口内部挂载，不提供 ./namespace 公开入口。

根入口同时导出 NamespaceNode、CommandNode 类及公共工具、映射、注册器配置/状态、Profile、节点权限/序列化、运行时绑定/结果和 Store 类型；ToolDefinition 类型转导出自原生 dsh-tools，供外部扩展使用。

## 执行与查询

`integration/presentation.ts` 通过 config.mode 选择 native/ptc 工具呈现与初始提示词，按作用域继承 preset 配置。仅显式挂载 presentation 的 Intellisense / Intellisense PTC 模式启用命名空间；标准模式及其它模式保持原生工具与提示词。执行模式仅由 presentation 配置选择，主插件和独立入口不声明默认模式，也不自动为会话挂载模式。

`namespace/component.ts` 管理 Profile、工具目录与共享 manifest。Intellisense 模式按会话渐进注册原生工具，初始仅提供 tools.inspect 和固定等级 2 的命令；等级 1 仅在 JSON 提示目录中显示路径和摘要，并保留父命名空间描述，仅精确查询函数路径后添加对应命令；挂载命令名称添加 ns_ 前缀，并以双下划线 __ 替换点号。命名空间通过普通匿名 NamespaceNode 及直接子节点引用表达，NodeType 仅为 leaf/tree。服务端 ToolsNamespaceNode 等节点管理受保护子树，Permission 描述编辑和固定等级限制，父节点删除成员前检查 removable；命令路径从父节点链派生，序列化不带父引用。命令通过 CommandNode 对象表达，调用时使用已绑定的物理 tool 与命名参数，经 DSH 原生执行流水线派发，权限由 DSH 处理。代理不进入物理工具目录，卸载时清理。

Intellisense PTC 模式仅向模型提供插件自有 tools_run_code 工具。`namespace/runtime.ts` 将已有受限 RuntimeHost 和 manifest 命名空间接入作用域执行入口，避免原生共享 run_code 选择部署的全局后端。两个模式在原生工具层均呈现 native，由插件组装器选择模型工具集合。PTC 初始化时将命令编译为 VM 函数绑定，VM 直接转换参数并通过 IPC 发送物理 tool 名称和底层参数；宿主不重复解析命名空间，不自行判定权限。子调用通过 DSH 原生执行流水线派发，保留父子审计、附加上下文和普通工具结果历史。本插件不拦截模型流，不解析代码围栏或提供源码续写。

`tools/inspect.ts` 注册 tools_inspect，固定映射 tools.inspect。查询列表包含尾点成员查询与精确签名查询，PTC 合并返回 TypeScript global 命名空间声明；DSML 返回 JSON 成员与命名参数 schema，并更新系统提示词中的工具集合，不提示 TS/JS。PTC 使用 tools.inspect(["std.", "std.cwd", "std.fs."])；DSML 调用同名工具，使用 { queries: string[] } 命名参数；PTC 接口为 function inspect(queries: string[]): Promise<string>，通过通用字段适配器传递单个字符串数组，tools.inspect([""]) 查询根命名空间。查询时忽略开头的 global. 前缀。结果通过普通工具历史返回，并保存 plugin:ts_intellisense/inspect 审计。

`runtime/` 管理每会话受限 Node 进程、严格 async 函数体、IPC、取消和超时。同一对话复用 VM Context，允许 globalThis 挂载变量跨调用共享；每次执行刷新命令与预加载值，VM 重启后状态丢失，不保证环境连续；移除 vm 命名空间及 vm.restart。console 输出写入内存流并通过 IPC 返回。DSML 模式不创建会话运行时。

## Profile 与工具表

`registry/registry.ts` 管理全局具名 Profile 目录、挂载路径、注释、排序和固定路径。`registry/profiles.ts` 为每会话持有独立配置快照，草稿覆盖保存且释放会话时删除；目录覆盖/删除不修改既有会话。普通新会话捕获 UI 默认配置；子 agent 首次初始化继承运行时父对话的当前 Profile 工作快照，包含未保存修改，之后父子各自独立；已有工作区会话的首页在含 intellisense-presentation 的 preset 右侧显示 Profile 下拉框，选择仅替换该会话快照并刷新工具和提示词，不更改全局默认。工具权限始终由原生 guard/策略决定。

tools.inspect 固定映射到内置 tools_inspect，启用时固定等级为 2，允许禁用。tools 包含 inspect、search 和 profile：profile.load(name?) 只读取当前会话草稿或目录中的具名 Profile 数据，不切换会话或刷新提示；profile.save(name, profile) 仅保存目录中的树，省略名称时使用当前 Profile 名称，也支持 save(profile)；profile.apply(name?, value) 按 load 规则读取后递归合并部分对象 patch，再复用 save；null 删除字段，数组整体替换。保存不更新当前会话配置或选择，显式 switch(name) 后应用保存的配置。profile.profiles 返回目录名称列表与当前会话选择（Profiles），native 下为无参数命令，PTC 下为随工具成功回复刷新的只读字段；profile.annotation 与 profile.commands 在 VM 执行前预加载为冻结常量，在 DSML 中为可直接调用的无参数工具，分别返回模型文档（DSML 为 JSON Schema）与排除插件内置命令的完整目录中的原始命令摘要、当前会话 Profile 的挂载路径 paths（包含被禁用的路径，未挂载时为空数组）及全局总调用次数 totalCalls（含当前上下文没有的命令）；其余旧 tools 管理命令移除。未配置物理工具需挂载或提供自定义别名后调用；不生成 unknown 命名空间。路径保留名称、重复和树碰撞检查。失效工具保留配置，但不进入实际 manifest、补全或执行环境。builtinVisible 记录内置固定提示偏好，按 Profile 保存；默认仅固定 tools.inspect。unmountedVisible 保存未挂载工具的固定提示偏好，不兼容旧字段名。

`storage/store.ts` 通过 DSH JSON backend 保存工具目录、具名 Profile 和会话工作快照；MemoryStore/FileStore 用于独立使用。`storage/journal_store.ts` 按存储前缀绑定可恢复写日志。统计只增量更新目标会话及全局计数，通过唯一计时器将 30 秒窗口内的脏记录合并保存；NamespaceComponent 释放时及插件关闭存储前均主动刷新。运行时不保存可执行状态或重放工具。

## Web UI

`web/panel/management_panel.tsx` 和 `web/panel/tree_provider.ts` 显示 tools 固定树与可配置命名空间；内置命令描述固定英文，界面中文集中到翻译表，其余 UI 支持中英文。内置命令不可改名、拖动或删除，tools.inspect 强制固定等级 2、禁用图钉切换；tools 命名空间与 tools.inspect 支持禁用，禁用后移除对应运行时工具及发现提示，tools.profile 显示嵌套子树，其余可用命令的图钉按 0 → 1 → 2 → 0 切换，等级 2 使用黄色图标，并按当前 Profile 草稿保存。

UI 不再显示 unknown 块。树上方显示当前可用但未挂载的工具数量，点击打开只含未挂载工具的选择器；数量随挂载、移除映射和切换 Profile 更新。失效工具不计入，映射不再保存 enabled 标志，移除映射即取消挂载；内置管理工具、run_code 和 tools_run_code 不计入未挂载工具。

`web/panel/tree_node.ts` 的 `TreeNode` 派生类实现共享 `Node` 接口，`NamespaceTree.root` 持有根节点，路径从父子引用派生，支持 type 和无父引用的 serialize。UI 接收服务端序列化 Permission，不按名称推断权限或生成节点；各节点在 tree_nodes 和 namespace/nodes 下按类拆分，上层组织初始结构；内置命令按钮按禁用、固定排列，不可禁用时隐藏禁用按钮；`web/panel/namespace_tree.ts` 处理路径、树迁移和混合拖动排序，固定内置节点禁止落入或移动。工具选择器仍可搜索普通可用工具并挂入根或指定命名空间。`web/profile_picker/` 实现 Profile 切换、创建、删除、重命名、保存和另存为；草稿名称带 *。`web/locale/` 保留本地化与原生语言桥接。运行时预算由 zod Config 管理；旧历史偏好接口及控件已移除。

`web/ui/` 集中共享控件、图标、动画、Tooltip 和代码渲染桥接；业务详情和专用图标保留在对应功能目录。宿主管理面板桥接位于 `web/panel/native_panel.tsx`，前后端共用的 Profile JSON 校验位于 `web/profile/profile_json.ts`。

`web/server/routes.ts` 的管理接口沿用原生 Connection 的认证和 Host/Origin 保护。“生成整理提案”由客户端创建默认模型的 Intellisense PTC 新会话，按界面语言预填整理提示，等待用户点击提交；服务端不再提供提案生成或批准接口。

## 构建和部署

根目录 locale/plugin、locale/preset 和 locale/presentation 分别保存主包及客户端共用元数据、preset 元数据与 presentation 元数据，通过各入口的 /locale/*.json 导出并随包发布；locale 不保留 model.md。

插件图标使用 `assets/icon.svg`，通过 package.json 的 icon 字段声明并纳入 files 发布清单；根入口与 client、preset、presentation 子路径均导出对应的 `/icon` 资源，供宿主读取插件显示元数据。

`run.mjs` 与 scripts/local_plugin.mjs 将本包登记为原生 bundle；本地启动按 checkout 和插件目录集合的摘要使用独立开发 profile，不改写共享 web profile。本地注册优先创建目录链接，失败时复制插件及已安装的运行依赖（解引用链接，排除 .git、build 和开发依赖），宿主提供 peer 依赖；副本记录源目录，每次启动刷新并清理旧文件。本地注册保留其它 link 依赖和 bundle，冲突时报错，相同配置不重复写 manifest。cordis.patch.yml 分别挂载主插件与 intellisense/preset 预设组件，由后者注册两个模式，agent-preset-registry 配置默认 intellisense-ptc。presets/intellisense_ptc 与 presets/intellisense 各自保存 preset.yml 模式元数据和完整的 agent.cordis.yml 插件配置；各自 YAML 显式声明 presentation.config.mode 为 ptc/native，注册入口仅加载、校验并注册，不注入或改写执行模式；默认不加载额外的 YAML 别名，可通过 aliasesFile 显式指定共享别名文件。两个模式分别通过 presentation 配置选择 ptc/native 呈现，并据此生成初始 prompt。

两个模式的 presentation 配置项 ID 统一为 intellisense-presentation，通过 config.mode 的 ptc/native 区分执行方式。保留基础包 ptc-runtime，供其它模式使用。Intellisense PTC 的 presentation 隔离 namespaceRuntime/codeRuntime 服务，并在自身作用域创建 NamespaceRuntime 与 RuntimeHost，不替换全局 ptcRuntime；内置工具也仅注册到两个自定义模式的 presentation 作用域。

package.json 的 build 命令依次调用 build:server 和 build:client；build:server 通过 tsc 编译生产源码并通过 esbuild CLI 打包 worker，build:client 打包原生管理客户端与独立管理页面，两者均可通过 pnpm 单独执行。根目录通过 pnpm-workspace.yaml 将根包声明为工作区，packageManager 固定 pnpm 12.14.0，依赖由 pnpm-lock.yaml 统一锁定。prepare 脚本仅执行 pnpm run build；prepack 脚本调用 scripts/release/prepare_package.mjs，按 files 清单将发布文件复制到 build/package；仅转换发布目录内中英文 README 的图片相对链接，所有本地图片统一使用 raw.githubusercontent.com，指向仓库 master 分支；源码 README 保留相对链接。发布 manifest 移除依赖源码的 scripts 和发布目录重定向，重复 prepack 清理旧暂存文件。publishConfig.directory 指定 build/package，linkDirectory=false 保留本地源码开发入口；发布工作流在编译完成后显式执行 npm run prepack --if-present，再从该目录以 --ignore-scripts 执行 npm pack，旧提交未声明 prepack 或发布目录时仍兼容从根目录打包。覆盖对应产物但不清理 dist，不调用外部构建脚本文件；内部脚本统一使用 pnpm run，支持 pnpm build，通过 pnpm-workspace.yaml 的 allowBuilds 明确允许现有依赖 @deepseek-ai/dsh-subprocess-local、@google/genai、esbuild、koffi、node-pty 和 protobufjs 运行安装构建脚本。原生管理客户端通过 esbuild banner/footer 包装为 __ModuleLoader__ 模块，独立管理页面和 worker 分别打包为浏览器 IIFE 与 Node ESM。源码分支不提交 dist/build 生成物。`.github/workflows/test.yml` 在推送 master、提交 PR 或手动触发时使用 Node 24 和 packageManager 声明的 pnpm，通过 pnpm install --frozen-lockfile 安装依赖，通过 pnpm test 构建并运行全部测试；不生成或更新 build Tag。`.github/workflows/publish.yml` 在推送 master 时读取非草稿 GitHub Release 的 Tag，通过 `scripts/release/collect_versions.mjs` 按拓扑顺序从旧到新遍历当前提交中尚未被成功 Release 覆盖的可达历史（包含合并分支历史）；每个未发布版本选择最新提交，后续 push 即使不修改版本号也会使用最新提交重试，直到创建对应 Release。已发布版本跳过，只有 Tag 而无 Release 不视为成功。逐个从记录的提交导出独立源码目录，使用 pnpm 安装和编译（旧提交没有 pnpm 锁文件时沿用 npm ci），并使用 npm pack 按包发布清单打包，发布 v<版本号> GitHub Release，Tag 指向该版本选定的最新提交。标题和正文为项目名称及版本，附件为 `<项目名称>-v<版本号>.tar.gz`（作用域包名去掉开头的 @，并将 / 替换为 -）；包保留 npm 标准的 package/ 顶层目录。受限运行时需要 Node >=24，直接使用 --permission，加载时实测文件读取与子进程创建被拒绝。Node 24 权限模型不限制网络，不提供系统调用级网络封锁。

## 验证

构建检查生产源码；已移除引用已删除模块的旧标记协议测试及独立脚本配置。双模式流程可使用 fake adapter 定向检查，无需真实模型请求。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。native 等级 1 仅生成 JSON 提示目录，不直接注册工具；等级 2 直接注册工具，精确查询的命令也会进入可调用工具列表。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；命令各自保留独立的提示等级。所有模式均不提供 console 命名空间及其命令、查询声明或管理节点；PTC 运行时原生 console 输出对象仍独立可用。

命令映射与命名空间通过可选 disabled 标志保存禁用状态；内置树使用 builtinDisabled 路径集合。禁用项保留在管理 UI，禁用按钮位于删除按钮左侧，节点变灰；manifest、补全、固定提示与 PTC 预加载排除禁用路径，命名空间禁用作用于所有后代。tools.inspect 允许禁用，不自动保底。

`search/` 通过 SearchEngine 接口与 SearchEngineRegistry 注册器提供命令搜索，支持可选 MiniSearch BM25、包含匹配及自定义同步/异步引擎。tools.search 固定映射 tools_search，默认不固定，可禁用；method 枚举及默认值从注册器选择器直接生成，只有一个引擎时移除该参数。defaultSearchMethod 配置及 searchEngines.setDefault 均可指定默认方法。详见 search/model.md。

发布元数据使用 Apache-2.0 许可，根目录 LICENSE 保存完整许可文本；engines.dsh 最低版本为 0.2.1-rc.2，repository 指向 origin，files 包含 dist、assets、cordis.patch.yml、README.md、README.zh-cn.md、LICENSE 和 presets。文档及许可通过 files 发布，不添加 exports 子路径。

文档截图通过 pnpm run screenshots 构建后调用 scripts/screenshots.mjs，复用主目录 Playwright 的 Chromium，运行内存示例 Profile 与生产管理页面，校验 Tooltip、二层类型与禁用卡片，生成中英文 namespace_table.png、tools.png、tooltip.png。脚本不访问用户数据或执行工具。assets/ 中的资源以完整文件内容使用普通 Git 版本控制，源码分支不记录 dist/build 产物。

`tools.profile.delete(name: string)` 删除全局目录中的指定配置；必须显式指定目标名称，省略或传入 undefined 时拒绝调用，删除当前会话配置一律拒绝。其它会话已有快照保留，成功删除后 PTC 的 profiles 字段随工具回复刷新。

`tools.profile.switch(name: string)` 显式切换当前会话配置，必须指定已有名称；可通过 builtinDisabled 禁用，使用普通内置命令的 disableable 权限。load(name?) 只读取配置数据，不切换当前会话；省略名称读取会话草稿，指定名称读取目录中的配置。

Profile save/apply 对受保护节点的移除、改名、移动、替换、文档修改及不允许的固定等级直接抛错，不再静默补齐或忽略。校验以目标目录配置为基线，新名称回退当前会话配置。普通命令的 command.doc 仍可省略。

同一物理工具的每个挂载路径独立保存描述、固定等级及禁用状态；Mapping 不再区分 path 与 aliases，每条记录只代表一个挂载路径，不兼容旧存档。命令目录中的挂载路径包含禁用及当前作用域不可用的配置路径；执行、搜索与提示仍排除禁用路径。

ToolsNamespace 与 Profile 为 interface；Profile 是无 name 的匿名树 snapshot，ProfileCollection 提供 list/get/create/getOrCreate/remove/edit。create 初始为空，edit(name, modifier) 原子保存回调返回的递归树，无 root getter 或 commit。节点由继承的内部 class 实现，公开方法返回 interface。RegistryConfiguration 与 RegistryState 仍为实现 Saveable 的存储类；ProfileDocument 是命名 JSON 传输的内部投影。

根目录 README.md 为英文完整文档，README.zh-cn.md 为中文完整文档，互相提供语言切换链接；assets/ 仅保存图标、横幅和分语言截图。

`intellisense-presentation` 的 config 可选配置 `profile: <name>`，会话优先使用指定具名 Profile，新对话首页的 Profile 按钮保持显示并置灰；会话选择接口和 tools.profile.switch 拒绝切换。省略时沿用默认及父会话继承行为。

Profile save 覆盖目录树时，受保护 tools 命名空间必须保留，默认禁用（省略 disabled 时禁用），显式 disabled: false 可启用；当前会话仍需显式 switch 才应用保存结果。annotation 与 schema 说明禁用节点及后代退出发现、调用绑定、预加载和提示，保留配置用于重新启用。

Profile save 保留原生 string | null 返回值：null 表示无提示的成功，inspect 无法调用且其它启用命令未全部固定等级 2 时返回建议字符串；建议不阻止保存，也不自动修改固定等级。权限违规直接抛错。

管理 UI 命名空间树在 inspect 不可调用且其它启用命令未全部固定等级 2 时，在下方展示黄色边框和背景的缩放淡入警告。此规则仅提示，不阻止操作或保存；应将其它命令固定为等级 2 或者禁用，保存说明与 annotation 同步此约定。

存储模型版本由 storage/version.ts 统一定义（当前 2）；全局 Profile、会话草稿和统计在版本变化时保留可加载内容，只丢弃失败部分。同版本错误可在管理 UI 加载错误叠层通过“刷新”后的“重置”触发局部恢复，保留有效配置和统计。


Profile 写入模型使用 `registry/profile_write.ts` 的 ProfileWrite（从 ProfileData 排除 name，递归排除 permissions），apply 使用递归 Partial 的 ProfilePatch。permissions 仅作为 load 的服务端只读规则返回；save/apply 对 name、permissions、未知字段（含 null 删除）强校验并抛错。调用方从 load 数据显式投影为写入树，宿主可使用 profileWrite；annotation 提供读取与写入两套类型，native annotation 返回写入 JSON Schema。null 仅删除可选字段或 children 成员，删除必填字段直接报告 null 输入。save/apply 仍只写目录，commands.paths 继续指向当前会话，验证保存结果用 load(name)，显式 switch 后才更新会话路径。

`src/error.ts` 定义 ValidationError、ProfilePermissionError、ProfileNotFoundError、ToolCallError 和 PositionalArgumentError。normalizeError 尝试将原生 ZodError 转换为 src/error.ts 自定义 ZodError，使用 ErrorData/ErrorIssue 结构与 type、path/message 紧凑 JSON；不判断长度、不修改原错误，转换不适用或失败时返回原错误；guest 的位置参数错误为带 toolName/code 的 ToolCallError 子类，服务端错误码随 IPC 回复传递。


管理页提供内置“使用文档”入口，按当前语言显示 docs/en/usage.md 与 docs/zh-cn/usage.md，构建时通过 Markdown 文本 loader 纳入客户端。文档随 package.files 发布；图片复用 README 的 assets/en 与 assets/zh 浅色截图，经认证的 ts-intellisense-docs-image 路由按语言及图片名称枚举读取。截图脚本同时检查浅色对比、深色回退、DSH token 优先级和原卡片凸耳保留；不使用截图专用背景修补。


ProfileRootWrite 的匿名根只允许 type/children，拒绝没有持久化表示的根级 disabled、fixedLevel、description（包括 apply 的 null 删除）；普通成员仍使用 NamespaceWrite/CommandWrite。ConversationRequiredError、ProfileLockedError、CurrentProfileDeletionError 与 UnknownCommandError 在 src/error.ts 定义，不再用普通 Error 或权限错误表达这些 Profile 失败；非法 patch 键使用 ValidationError。

文档截图脚本额外生成配置工具栏 profile_editor.png 与局部命名空间树 namespace_tree.png。new_conversation.png 截取真实 DSH 新对话的模式、配置菜单和输入区，使用浏览器预览示例，不含侧边栏或历史会话。使用文档按操作章节插入局部截图，文档路由继续使用固定名称枚举。

构建配置统一由 scripts/build.mjs 管理，支持 all/server/client；pnpm run build 按服务端、worker、插件客户端、独立页顺序构建，避免 tsc 覆盖最终浏览器产物。package.json 只保留构建脚本入口，脚本间调用统一使用 pnpm。依赖 external、压缩、loader 与宿主注册包装在构建脚本维护。

工具附加属性通过 ToolAddition 的 fixed、hidden、ptcDescription 声明；内置工具也使用 toolsNamespace 的相同接口注册。fixed 禁止人工和 agent 挂载，hidden 隐藏目录及选择器，PTC 注释可独立覆盖且缺省回退物理工具原文。内置节点通过 edit 显式创建；空 Profile 不自动注入节点。


工具节点统一为 CommandNode，操作许可仅由 permissions 决定。工具提供者通过 setToolAddition 注册 project（模式契约、签名、参数布局、返回策略）、discovery 标记及 value 生产器/刷新策略；通用树构建不识别内置命令表。默认固定等级由节点定义提供，RegistryConfiguration 不假设 tools.inspect。

agent 的 tools.profile.save/apply 统一调用 toolsNamespace.saveProfile，经过 effect('save', handler) 顺序处理独立的 ProfileSaveEvent 后，再按服务端权限校验并原子持久化。事件提供 profile、baseline 可编辑快照、operation、tools 和可修改的 result；异常不写入目录。内置插件自行注册修复 effect，恢复 tools 子树、工具绑定、权限及 inspect 固定等级；save 仍默认禁用 tools，apply 保留原禁用状态。插件侧 edit 是可信编辑入口，不触发 agent 保存 effect；新建 Profile 仍为空。
