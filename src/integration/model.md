# 集成模型

`namespace_plugin.ts` 装配共享 Profile、管理 UI、tools_intellisense、命名空间树和模式提示。主入口 index.ts 提供运行时配置；仅 PTC presentation 创建 codeRuntime 与 NamespaceRuntime；独立入口 ./namespace 默认 native，不创建 JS 运行时。

`presentation.ts` 参考 dsh-agent-tool-presentation 的作用域生命周期，配置 mode 为 ptc/native，两个模式均调用 tools.presentAs('native')，避免原生共享 run_code 使用全局后端。PTC 在隔离的 namespaceRuntime/codeRuntime 服务作用域创建插件执行入口。配置按 scope 继承，命名空间组件及初始 prompt 从同一配置读取模式，不依赖 preset ID。无显式 presentation 的会话不启用本插件的工具、运行时或提示词；内置工具在 presentation 作用域注册，PTC 运行时也在该作用域创建。

`preset.ts` 注册 Intellisense PTC 和 Intellisense 两个 Agent Mode；各自 composition 统一使用 intellisense-presentation 配置项 ID，加载 dsh-intellisense/presentation，通过 config.mode 的 ptc/native 区分执行方式。能力清单保留规划、技能及子代理支持。

`namespace_runtime.ts` 注册插件自有的 tools_run_code，使用已有受限 RuntimeHost 执行完整 TS/JS 函数体，不依赖或替换部署的全局 ptcRuntime。只在 Intellisense PTC presentation 作用域挂载，模型仅见 tools_run_code；物理目录和 manifest 排除此入口，禁止递归调用。轨迹调用卡片使用 description 作为标题，以 TypeScript 代码块展示 code。每次按实际调用者 manifest 验证路径，通过 namespace_component.dispatch 将位置参数转换为原生参数，沿用原生 guard/execute、父子审计和附加上下文转发，返回值只投影一次并保留 undefined。显式超时限制在部署上限内，按实际 Agent owner 释放状态。取消先解除 IPC 回调等待，再取消并等待所有真实子调用；程序结束时也取消并等待未完成子调用，避免循环等待和后台遗留执行。执行失败保留原始错误和已捕获输出，以 CodeRunFailedError 返回。插件不解析模型流或代码围栏。

`namespace_component.ts` 在 native 模式下按会话注册命名空间代理。代理使用命名参数，按 YAML argMap 转换字段；每次执行按实际调用者重新验证 manifest，并通过物理工具的原生执行流水线派发。生成代理不进入物理工具目录，仅挂载 tools.intellisense、固定命令和会话已查询的直接成员，变更 manifest 后替换，释放会话或卸载时清理；不为无显式配置的会话创建默认呈现。PTC 模式仅向模型暴露 tools_run_code，native 模式仅暴露当前渐进发现集合中的命名空间工具。

`native_tools.ts` 为 native 代理生成符合 API 字符及 64 字符长度限制的名称，例如 tools.intellisense 对应 tools__intellisense，std.cwd 对应 std__cwd。点号替换为双下划线，不添加 ns_ 前缀；美元符号编码，长路径使用摘要，并为名称碰撞添加数字后缀。内置管理代理派发到原始物理工具；代理名称避让物理工具名称。原生模式不额外生成 namespaces/tools JSON 目录，当前可调用名称由工具 schema 提供。Profile、IntelliSense 查询与 PTC 继续使用原路径。

管理目录异步汇总全局、可用预设的 standing scope 及活动会话工具，以物理名称去重；读取预设使用 acquireScope 并始终释放 lease，无需创建会话。损坏的预设不参与目录，会话运行时仍只读取实际调用者作用域的物理工具，不能从管理目录继承其他预设权限。

Profile 可同时保存来自多个预设的映射；当前模型作用域未挂载的物理工具不参与 effective/manifest，不影响其余映射，也不删除原始配置。后续挂载对应工具后原映射自动参与解析。

`intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。工具结果卡片使用代码块展示输入/输出 schema 和查询结果（PTC 为 TypeScript，native 为 JSON，错误为 text），原生命名空间代理沿用此展示及输出 schema。物理工具及 native 代理保留 { queries: string[] } 命名参数；PTC 接口为 function intellisense(...args: string[]): Promise<string>，接收多个字符串参数，无需数组或 queries 对象包装，tools.intellisense("") 查询根命名空间，派发时还原物理工具的 queries 字段。两种模式查询时均忽略开头的 global. 前缀，global. 等同于根目录查询。尾点查询列出直接子项，精确路径展开签名和文档，PTC 多查询合并为 TypeScript global 命名空间树。native 返回 JSON 直接成员列表，精确查询附带命名参数 schema；只添加查询命中的直接命令，不递归挂载后代。native 查询会更新会话发现集合、同步工具并发出 system-prompt/change，使下一次组装包含新增工具。结果作为普通工具响应进入原生历史，并保存查询审计。会话释放时清除发现集合。

`namespace.ts` 统一 PTC 参数投影、DSML schema/命名参数映射、返回值投影和声明生成。tools.intellisense 为固定内置项，不受 Profile 启用偏好影响。tools.profile.load/save 通过原生工具执行；annotation/commands 在 native 中是无参调用，annotation 返回 Profile JSON Schema；在 PTC 中是预加载常量，annotation 保留 TypeScript 声明。旧 tools 管理命令已移除。

`prompt.ts` 根据 native/ptc 配置生成初始说明，PTC 渲染 Profile 选中的部分命名空间树。未知命令先直接查询 tools.intellisense；PTC 通过 tools_run_code 调用命名空间，native 直接使用 DSML 命名空间工具。native 初始提示强调当前工具基于命名空间，双下划线 __ 是调用名称中的命名空间分隔符，对应查询路径中的点号；不再附加根命名空间摘要和工具映射 JSON，描述只保留在工具 schema 中，不生成 TS/JS 声明或执行说明。

固定提示按命令等级生成：0 不输出，1 输出 Function 占位和 Profile 简略注释，2 输出完整签名与 @brief、@param、@returns 文档。详细工具文档沿用 IntelliSense 声明投影，参数别名与返回值解包规则相同；无参数命令不生成虚构 @param。tools.intellisense 强制固定等级 2，移除 setFixed 操作。

`tool_commands.ts` 仅注册 Profile load/save/annotation/commands。save 支持显式名称或当前会话名称，验证递归树与物理命令身份，发布目录并替换当前会话配置；load 无名称只返回草稿，有名称切换会话版本。`namespace_runtime.ts` 将 annotation 和原始命令列表作为数据传给 VM init，不安装同名函数。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

`builtin_trace.ts` 在 presentation 作用域包装内置工具注册，保存实际参数/输出 schema、调用参数、返回值、错误与耗时到独立插件审计。结果保持原始模型内容，字符串结果不再额外 JSON 编码。审计和 Profile annotation 通过调用者上下文的 get() 获取命名空间服务，不要求调用者插件显式注入 commandNamespaces。

PTC 每次执行重建 VM Context，不保证环境连续，不支持 globalThis，不提供 vm 命名空间或 vm.restart。tools.profile.commands 使用完整管理目录，含当前上下文没有的命令；save 校验同一目录，但执行仍受调用者作用域权限控制。内置命令描述固定英文。整理入口创建未提交的新 PTC 对话草稿，不再调用维护子代理。
