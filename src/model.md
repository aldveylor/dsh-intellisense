# 源码模型

包名为 dsh-intellisense。默认入口 index.ts 组合命名空间服务与受限运行时，注册 Intellisense PTC（intellisense-ptc，TS/JS 执行）和 Intellisense（intellisense，原生 DSML 执行）两个 Agent Mode；包入口 ./namespace 可独立挂载原生命名空间服务，不创建 VM。

## 执行与查询

`integration/presentation.ts` 通过 config.mode 选择 native/ptc 工具呈现与初始提示词，按作用域继承 preset 配置。仅显式挂载 presentation 的 Intellisense / Intellisense PTC 模式启用命名空间；标准模式及其它模式保持原生工具与提示词。执行模式仅由 presentation 配置选择，主插件和独立入口不声明默认模式，也不自动为会话挂载模式。

`integration/namespace_component.ts` 管理 Profile、工具目录与共享 manifest。Intellisense 模式按会话渐进注册原生工具，初始仅提供 tools.intellisense 和固定命令，查询后添加直接成员；挂载命令名称添加 ns_ 前缀，并以双下划线 __ 替换点号。执行时根据实际调用者重新验证可见性，并通过原生 guard/execute 流水线派发。代理不进入物理工具目录，卸载时清理。

Intellisense PTC 模式仅向模型提供插件自有 tools_run_code 工具。`integration/namespace_runtime.ts` 将已有受限 RuntimeHost 和 manifest 命名空间接入作用域执行入口，避免原生共享 run_code 选择部署的全局后端。两个模式在原生工具层均呈现 native，由插件组装器选择模型工具集合。子调用仍通过原生权限与执行流水线派发，保留父子审计、附加上下文和普通工具结果历史。本插件不拦截模型流，不解析代码围栏或提供源码续写。

`integration/intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。查询列表包含尾点成员查询与精确签名查询，PTC 合并返回 TypeScript global 命名空间声明；DSML 返回 JSON 成员与命名参数 schema，并更新系统提示词中的工具集合，不提示 TS/JS。PTC 使用 tools.intellisense("std.", "std.cwd", "std.fs.")；DSML 调用同名工具，保留 { queries: string[] } 命名参数；PTC 接口为 function intellisense(...args: string[]): Promise<string>，接收多个字符串参数，tools.intellisense("") 查询根命名空间，无需数组或 queries 对象包装。查询时忽略开头的 global. 前缀。结果通过普通工具历史返回，并保存 plugin:ts_intellisense/intellisense 审计。

`runtime/` 管理每会话受限 Node 进程、严格 async 函数体、IPC、取消和超时。每次执行重建 VM Context，不保证环境连续，globalThis 不受支持；移除 vm 命名空间及 vm.restart。console 输出写入内存流并通过 IPC 返回。DSML 模式不创建会话运行时。

## Profile 与工具表

`registry/registry.ts` 管理全局具名 Profile 目录、映射、别名、注释、排序和固定路径。`registry/profiles.ts` 为每会话持有独立配置快照，草稿覆盖保存且释放会话时删除；目录覆盖/删除不修改既有会话。新会话捕获 UI 当前选中配置。工具权限始终由原生 guard/策略决定。

tools.intellisense 固定映射到内置 tools_intellisense，强制固定等级 2，不受 Profile 图钉偏好影响。tools 仅保留 intellisense 和 profile：profile.load(name?) 返回当前或加载具名 Profile；profile.save(name, profile) 保存树，省略名称时使用当前 Profile，也支持 save(profile)。profile.annotation 与 profile.commands 在 VM 执行前预加载为冻结常量，在 DSML 中为可直接调用的无参数工具，分别返回模型文档（DSML 为 JSON Schema）与完整目录中的原始命令摘要（含当前上下文没有的命令）；其余旧 tools 管理命令移除。未配置物理工具需挂载或提供自定义别名后调用；不生成 unknown 命名空间。路径保留名称、重复和树碰撞检查。失效工具保留配置，但不进入实际 manifest、补全或执行环境。builtinVisible 记录内置固定提示偏好，按 Profile 保存；默认仅固定 tools.intellisense，console 等标准接口默认不固定提示。unmountedVisible 保存未挂载工具的固定提示偏好，不兼容旧字段名。

`storage/store.ts` 通过 DSH JSON backend 保存工具目录、具名 Profile 和会话工作快照；MemoryStore/FileStore 用于独立使用。运行时不保存可执行状态或重放工具。

## 管理 UI

`management/panel/management_panel.tsx` 和 `management/panel/tree_provider.ts` 显示 console、tools 固定树与可配置命名空间；内置命令描述固定英文，界面中文集中到翻译表，其余 UI 支持中英文。内置命令不可改名、拖动或删除，tools.intellisense 强制固定等级 2、禁用图钉切换，tools.profile 显示嵌套子树，其余可用命令的图钉按 0 → 1 → 2 → 0 切换，等级 2 使用黄色图标，并按当前 Profile 草稿保存。

UI 不再显示 unknown 块。树上方显示当前可用但未挂载的工具数量，点击打开只含未挂载工具的选择器；数量随挂载、移除映射和切换 Profile 更新。失效工具不计入，映射不再保存 enabled 标志，移除映射即取消挂载；内置管理工具、run_code 和 tools_run_code 不计入未挂载工具。

`management/panel/namespace_tree.ts` 处理路径、树迁移和混合拖动排序，固定内置节点禁止落入或移动。工具选择器仍可搜索普通可用工具并挂入根或指定命名空间。`management/profile_picker/` 实现 Profile 切换、创建、删除、重命名、保存和另存为；草稿名称带 *。`management/locale/` 保留本地化与原生语言桥接。运行时预算由 zod Config 管理；旧历史偏好接口及控件已移除。

`management/server/routes.ts` 的管理接口沿用原生 Connection 的认证和 Host/Origin 保护。“生成整理提案”由客户端创建默认模型的 Intellisense PTC 新会话，按界面语言预填整理提示，等待用户点击提交；服务端不再提供提案生成或批准接口。

## 构建和部署

`run.mjs` 与 scripts/local_plugin.mjs 将本包登记为原生 bundle；本地启动按 checkout 和插件目录集合的摘要使用独立开发 profile，不改写共享 web profile。本地注册保留其它 link 依赖和 bundle，冲突时报错，相同配置不重复写 manifest。cordis.patch.yml 注册插件和两个模式，默认 intellisense-ptc。presets/intellisense_ptc 与 presets/intellisense 保存各自模式元数据；共享能力清单位于 presets/agent.cordis.yml，预设加载时注入对应 presentation mode；共享 YAML 别名位于 presets/intellisense_ptc/aliases.yml。两个模式分别通过 presentation 配置选择 ptc/native 呈现，并据此生成初始 prompt。

两个模式的 presentation 配置项 ID 统一为 intellisense-presentation，通过 config.mode 的 ptc/native 区分执行方式。保留基础包 ptc-runtime，供其它模式使用。Intellisense PTC 的 presentation 隔离 namespaceRuntime/codeRuntime 服务，并在自身作用域创建 NamespaceRuntime 与 RuntimeHost，不替换全局 ptcRuntime；内置工具也仅注册到两个自定义模式的 presentation 作用域。

构建清理 dist 并编译生产源码、管理客户端及 worker。dist/build 生成物不提交。受限运行时需要 Node >=24，直接使用 --permission，加载时实测文件读取与子进程创建被拒绝。Node 24 权限模型不限制网络，不提供系统调用级网络封锁。

## 验证

构建检查生产源码；已移除引用已删除模块的旧标记协议测试及独立脚本配置。双模式流程可使用 fake adapter 定向检查，无需真实模型请求。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。
