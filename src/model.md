# 源码模型

包名为 @aldveylor/dsh-intellisense。默认入口 index.ts 组合命名空间服务与受限运行时，注册 Intellisense PTC（intellisense-ptc，TS/JS 执行）和 Intellisense（intellisense，原生 DSML 执行）两个 Agent Mode；包入口 ./namespace 可独立挂载原生命名空间服务，不创建 VM。

根入口同时导出 NamespaceNode、CommandNode 类及公共工具、映射、注册器配置/状态、Profile、节点权限/序列化、运行时绑定/结果和 Store 类型；ToolDefinition 类型转导出自原生 dsh-tools，供外部扩展使用。

## 执行与查询

`integration/presentation.ts` 通过 config.mode 选择 native/ptc 工具呈现与初始提示词，按作用域继承 preset 配置。仅显式挂载 presentation 的 Intellisense / Intellisense PTC 模式启用命名空间；标准模式及其它模式保持原生工具与提示词。执行模式仅由 presentation 配置选择，主插件和独立入口不声明默认模式，也不自动为会话挂载模式。

`namespace/component.ts` 管理 Profile、工具目录与共享 manifest。Intellisense 模式按会话渐进注册原生工具，初始仅提供 tools.intellisense 和固定命令，仅精确查询函数路径后添加对应命令；挂载命令名称添加 ns_ 前缀，并以双下划线 __ 替换点号。命名空间通过普通匿名 NamespaceNode 及直接子节点引用表达，NodeType 仅为 leaf/tree。服务端 ToolsNamespaceNode 等节点管理受保护子树，Permission 描述编辑和固定等级限制，父节点删除成员前检查 removable；命令路径从父节点链派生，序列化不带父引用。命令通过 CommandNode 对象表达，调用时使用已绑定的物理 tool 与命名参数，经 DSH 原生执行流水线派发，权限由 DSH 处理。代理不进入物理工具目录，卸载时清理。

Intellisense PTC 模式仅向模型提供插件自有 tools_run_code 工具。`namespace/runtime.ts` 将已有受限 RuntimeHost 和 manifest 命名空间接入作用域执行入口，避免原生共享 run_code 选择部署的全局后端。两个模式在原生工具层均呈现 native，由插件组装器选择模型工具集合。PTC 初始化时将命令编译为 VM 函数绑定，VM 直接转换参数并通过 IPC 发送物理 tool 名称和底层参数；宿主不重复解析命名空间，不自行判定权限。子调用通过 DSH 原生执行流水线派发，保留父子审计、附加上下文和普通工具结果历史。本插件不拦截模型流，不解析代码围栏或提供源码续写。

`tools/intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。查询列表包含尾点成员查询与精确签名查询，PTC 合并返回 TypeScript global 命名空间声明；DSML 返回 JSON 成员与命名参数 schema，并更新系统提示词中的工具集合，不提示 TS/JS。PTC 使用 tools.intellisense("std.", "std.cwd", "std.fs.")；DSML 调用同名工具，保留 { queries: string[] } 命名参数；PTC 接口为 function intellisense(...args: string[]): Promise<string>，接收多个字符串参数，tools.intellisense("") 查询根命名空间，无需数组或 queries 对象包装。查询时忽略开头的 global. 前缀。结果通过普通工具历史返回，并保存 plugin:ts_intellisense/intellisense 审计。

`runtime/` 管理每会话受限 Node 进程、严格 async 函数体、IPC、取消和超时。同一对话复用 VM Context，允许 globalThis 挂载变量跨调用共享；每次执行刷新命令与预加载值，VM 重启后状态丢失，不保证环境连续；移除 vm 命名空间及 vm.restart。console 输出写入内存流并通过 IPC 返回。DSML 模式不创建会话运行时。

## Profile 与工具表

`registry/registry.ts` 管理全局具名 Profile 目录、挂载路径、注释、排序和固定路径。`registry/profiles.ts` 为每会话持有独立配置快照，草稿覆盖保存且释放会话时删除；目录覆盖/删除不修改既有会话。普通新会话捕获 UI 默认配置；子 agent 首次初始化继承运行时父对话的当前 Profile 工作快照，包含未保存修改，之后父子各自独立；已有工作区会话的首页在含 intellisense-presentation 的 preset 右侧显示 Profile 下拉框，选择仅替换该会话快照并刷新工具和提示词，不更改全局默认。工具权限始终由原生 guard/策略决定。

tools.intellisense 固定映射到内置 tools_intellisense，强制固定等级 2，不受 Profile 图钉偏好影响。tools 包含 intellisense、search 和 profile：profile.load(name?) 只读取当前会话草稿或目录中的具名 Profile 数据，不切换会话或刷新提示；profile.save(name, profile) 仅保存目录中的树，省略名称时使用当前 Profile 名称，也支持 save(profile)；保存不更新当前会话配置或选择，显式 switch(name) 后应用保存的配置。profile.profiles 返回目录名称列表与当前会话选择（Profiles），native 下为无参数命令，PTC 下为随工具成功回复刷新的只读字段；profile.annotation 与 profile.commands 在 VM 执行前预加载为冻结常量，在 DSML 中为可直接调用的无参数工具，分别返回模型文档（DSML 为 JSON Schema）与排除插件内置命令的完整目录中的原始命令摘要、当前会话 Profile 的挂载路径 paths（包含被禁用的路径，未挂载时为空数组）及全局总调用次数 totalCalls（含当前上下文没有的命令）；其余旧 tools 管理命令移除。未配置物理工具需挂载或提供自定义别名后调用；不生成 unknown 命名空间。路径保留名称、重复和树碰撞检查。失效工具保留配置，但不进入实际 manifest、补全或执行环境。builtinVisible 记录内置固定提示偏好，按 Profile 保存；默认仅固定 tools.intellisense，console 等标准接口默认不固定提示。unmountedVisible 保存未挂载工具的固定提示偏好，不兼容旧字段名。

`storage/store.ts` 通过 DSH JSON backend 保存工具目录、具名 Profile 和会话工作快照；MemoryStore/FileStore 用于独立使用。运行时不保存可执行状态或重放工具。

## 管理 UI

`management/panel/management_panel.tsx` 和 `management/panel/tree_provider.ts` 显示 console、tools 固定树与可配置命名空间；内置命令描述固定英文，界面中文集中到翻译表，其余 UI 支持中英文。内置命令不可改名、拖动或删除，tools.intellisense 强制固定等级 2、禁用图钉切换，tools.profile 显示嵌套子树，其余可用命令的图钉按 0 → 1 → 2 → 0 切换，等级 2 使用黄色图标，并按当前 Profile 草稿保存。

UI 不再显示 unknown 块。树上方显示当前可用但未挂载的工具数量，点击打开只含未挂载工具的选择器；数量随挂载、移除映射和切换 Profile 更新。失效工具不计入，映射不再保存 enabled 标志，移除映射即取消挂载；内置管理工具、run_code 和 tools_run_code 不计入未挂载工具。

`management/panel/tree_node.ts` 的 `TreeNode` 派生类实现共享 `Node` 接口，`NamespaceTree.root` 持有根节点，路径从父子引用派生，支持 type 和无父引用的 serialize。UI 接收服务端序列化 Permission，不按名称推断权限或生成节点；各节点在 tree_nodes 和 namespace/nodes 下按类拆分，上层组织初始结构；内置命令按钮按禁用、固定排列，不可禁用时隐藏禁用按钮；`management/panel/namespace_tree.ts` 处理路径、树迁移和混合拖动排序，固定内置节点禁止落入或移动。工具选择器仍可搜索普通可用工具并挂入根或指定命名空间。`management/profile_picker/` 实现 Profile 切换、创建、删除、重命名、保存和另存为；草稿名称带 *。`management/locale/` 保留本地化与原生语言桥接。运行时预算由 zod Config 管理；旧历史偏好接口及控件已移除。

`management/server/routes.ts` 的管理接口沿用原生 Connection 的认证和 Host/Origin 保护。“生成整理提案”由客户端创建默认模型的 Intellisense PTC 新会话，按界面语言预填整理提示，等待用户点击提交；服务端不再提供提案生成或批准接口。

## 构建和部署

插件图标使用 `docs/icon.svg`，通过 package.json 的 icon 字段声明并纳入 files 发布清单；根入口与 client、preset、namespace、presentation 子路径均导出对应的 `/icon` 资源，供宿主读取插件显示元数据。

`run.mjs` 与 scripts/local_plugin.mjs 将本包登记为原生 bundle；本地启动按 checkout 和插件目录集合的摘要使用独立开发 profile，不改写共享 web profile。本地注册保留其它 link 依赖和 bundle，冲突时报错，相同配置不重复写 manifest。cordis.patch.yml 注册插件和两个模式，默认 intellisense-ptc。presets/intellisense_ptc 与 presets/intellisense 各自保存 preset.yml 模式元数据和完整的 agent.cordis.yml 插件配置；各自 YAML 显式声明 presentation.config.mode 为 ptc/native，注册入口仅加载、校验并注册，不注入或改写执行模式；默认不加载额外的 YAML 别名，可通过 aliasesFile 显式指定共享别名文件。两个模式分别通过 presentation 配置选择 ptc/native 呈现，并据此生成初始 prompt。

两个模式的 presentation 配置项 ID 统一为 intellisense-presentation，通过 config.mode 的 ptc/native 区分执行方式。保留基础包 ptc-runtime，供其它模式使用。Intellisense PTC 的 presentation 隔离 namespaceRuntime/codeRuntime 服务，并在自身作用域创建 NamespaceRuntime 与 RuntimeHost，不替换全局 ptcRuntime；内置工具也仅注册到两个自定义模式的 presentation 作用域。

package.json 的 build 命令依次调用 build:server 和 build:client；build:server 通过 tsc 编译生产源码并通过 esbuild CLI 打包 worker，build:client 打包原生管理客户端与独立管理页面，两者均可通过 pnpm 单独执行。prepare 脚本执行 npm run build，在安装和打包的 prepare 阶段构建。覆盖对应产物但不清理 dist，不调用外部构建脚本文件；支持 pnpm build 和 npm run build，不添加 allowBuilds 名单。原生管理客户端通过 esbuild banner/footer 包装为 __ModuleLoader__ 模块，独立管理页面和 worker 分别打包为浏览器 IIFE 与 Node ESM。源码分支不提交 dist/build 生成物。`.github/workflows/build_tag.yml` 在推送 master 后，从当前源码创建临时构建分支，使用 Node 24、npm ci 和 npm run build 编译，提交源码与编译产物并更新固定 build Tag，不修改 master。`.github/workflows/publish_release.yml` 在 master 的 package.json 版本号相较推送前发生变化时，编译并使用 npm pack 按包发布清单打包，发布 v<版本号> GitHub Release，标题和正文为项目名称及版本，附件为 `<项目名称>-v<版本号>.tar.gz`（作用域包名去掉开头的 @，并将 / 替换为 -）；包保留 npm 标准的 package/ 顶层目录。受限运行时需要 Node >=24，直接使用 --permission，加载时实测文件读取与子进程创建被拒绝。Node 24 权限模型不限制网络，不提供系统调用级网络封锁。

## 验证

构建检查生产源码；已移除引用已删除模块的旧标记协议测试及独立脚本配置。双模式流程可使用 fake adapter 定向检查，无需真实模型请求。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；不使用 console 专有存储字段。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

命令映射与命名空间通过可选 disabled 标志保存禁用状态；内置树使用 builtinDisabled 路径集合。禁用项保留在管理 UI，禁用按钮位于删除按钮左侧，节点变灰；manifest、补全、固定提示与 PTC 预加载排除禁用路径，命名空间禁用作用于所有后代。tools.intellisense 保留可用。

`search/` 通过 SearchEngine 接口与 SearchEngineRegistry 注册器提供命令搜索，支持可选 MiniSearch BM25、包含匹配及自定义同步/异步引擎。tools.search 固定映射 tools_search，默认不固定，可禁用；method 枚举及默认值从注册器选择器直接生成，只有一个引擎时移除该参数。defaultSearchMethod 配置及 searchEngines.setDefault 均可指定默认方法。详见 search/model.md。

发布元数据使用 Apache-2.0 许可，根目录 LICENSE 保存完整许可文本；engines.dsh 最低版本为 0.2.1-rc.2，repository 指向 origin，files 包含 dist、docs、cordis.patch.yml、README.md、LICENSE 和 presets。文档及许可通过 files 发布，不添加 exports 子路径。

文档截图通过 npm run screenshots 构建后调用 scripts/screenshots.mjs，复用主目录 Playwright 的 Chromium，运行内存示例 Profile 与生产管理页面，校验 Tooltip、二层类型与禁用卡片，生成中英文 namespace_table.png、tools.png、tooltip.png。脚本不访问用户数据或执行工具。所有 PNG 使用 Git LFS，源码分支不记录 dist/build 产物。

`tools.profile.delete(name: string)` 删除全局目录中的指定配置；必须显式指定目标名称，省略或传入 undefined 时拒绝调用，删除当前会话配置一律拒绝。其它会话已有快照保留，成功删除后 PTC 的 profiles 字段随工具回复刷新。

`tools.profile.switch(name: string)` 显式切换当前会话配置，必须指定已有名称；可通过 builtinDisabled 禁用，使用普通内置命令的 disableable 权限。load(name?) 只读取配置数据，不切换当前会话；省略名称读取会话草稿，指定名称读取目录中的配置。

Profile 保存递归补齐省略的 console/tools 固定节点；同名节点仅检查和补齐下一层，不覆盖提交的 fixedLevel、disabled 等设置。恢复值来自目标目录 Profile，新名称回退到当前会话配置。commentable 权限控制简化注释编辑，受保护节点禁止修改，提交的相关注释键被忽略；Profile 输入中的 command.doc 可省略。

同一物理工具的每个挂载路径独立保存描述、固定等级及禁用状态；Mapping 不再区分 path 与 aliases，每条记录只代表一个挂载路径，不兼容旧存档。命令目录中的挂载路径包含禁用及当前作用域不可用的配置路径；执行、搜索与提示仍排除禁用路径。

Profile、RegistryConfiguration 与 RegistryState 为可导出的运行时类，公共入口导出类及其 Data 类型；均实现 Saveable<T>.save()，通过 constructor(data?) 恢复独立实例。会话和目录内部使用类，存储/HTTP/PTC 传递纯数据；Profile 树的节点结构与操作规则保持不变。
