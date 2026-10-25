# 工具模型

内置工具在 presentation 作用域注册，通过 NamespaceComponent 读取当前会话命名空间。命名空间实现位于 `../namespace/`，搜索引擎实现在 `../search/`。

`intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。工具结果卡片使用代码块展示输入/输出 schema 和查询结果（PTC 为 TypeScript，native 为 JSON，错误为 text），原生命名空间代理沿用此展示及输出 schema。物理工具及 native 代理保留 { queries: string[] } 命名参数；PTC 接口为 function intellisense(...args: string[]): Promise<string>，接收多个字符串参数，无需数组或 queries 对象包装，tools.intellisense("") 查询根命名空间，派发时还原物理工具的 queries 字段。两种模式查询时均忽略开头的 global. 前缀，global. 等同于根目录查询。尾点查询列出直接子项，精确路径展开签名和文档，PTC 多查询合并为 TypeScript global 命名空间树。native 返回 JSON 直接成员列表，精确查询附带命名参数 schema；只添加查询命中的直接命令，不递归挂载后代。native 查询会更新会话发现集合、同步工具并发出 system-prompt/change，使下一次组装包含新增工具。结果作为普通工具响应进入原生历史，并保存查询审计。会话释放时清除发现集合。

`tool_commands.ts` 仅注册 Profile load/save/annotation/commands。save 支持显式名称或当前会话名称，验证递归树与物理命令身份，发布目录并替换当前会话配置；load 无名称只返回草稿，有名称切换会话版本。`namespace_runtime.ts` 将 annotation 和原始命令列表作为数据传给 VM init，不安装同名函数。

`builtin_trace.ts` 在 presentation 作用域包装内置工具注册，保存实际参数/输出 schema、调用参数、返回值、错误与耗时到独立插件审计。结果保持原始模型内容，字符串结果不再额外 JSON 编码。审计和 Profile annotation 通过调用者上下文的 get() 获取命名空间服务，不要求调用者插件显式注入 commandNamespaces。

`tool_search.ts` 将 tools_search 注册到 presentation 作用域并映射 tools.search。搜索参数直接由 SearchEngineRegistry.selector 生成；引擎注册、卸载或默认方法变更后重新注册工具并通知提示重组。searchEngines 由 NamespaceComponent 持有，通过 commandNamespaces 服务供其它插件注册；主插件和 namespace 独立入口均接受 defaultSearchMethod。搜索只返回当前有效树中的完整命令路径，提示使用 tools.intellisense 获取详细信息。声明、PTC 位置参数和 UI 提示共同读取实际物理 schema 中的方法枚举。
