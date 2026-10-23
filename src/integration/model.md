# Text PTC 模式模型

`src/index.ts` 装配 Text PTC 模式。普通 AgentLoop 主请求交给 TextExecAdapter；标题、压缩和原生子代理不走该接管。原生循环拥有 exec 执行，适配器仅合成工具块，避免重复执行。

`adapter.ts` 注册宿主 exec 工具，并从 agent/request 获取真实 turn/step。每次请求保留原人设、技能、项目指令和模式策略；原工具协议分区由 assemble waterfall 移除，将末尾 js:exec/ts:exec 协议及“命名空间”只读树写入系统提示词装配，清空模型请求的原生工具 schema，使初始系统提示词记录与实际输入一致，明确所有工具（含提问和展示）通过运行时命名空间调用，禁止输出原生工具调用或 DSML 标记。提示提供可直接照写的完整 js:exec 示例，区分普通代码展示与实际执行，要求取得执行结果后再回答；内部推演使用 reasoning 通道，正文只保留面向用户的简要说明和答案。系统提示词包含明确的未闭合围栏补全示例，首次使用尚未获得签名的命令必须输出配置 marker 并立即停止，另说明 LINEBREAK/BREAK；用户可见说明与回答跟随用户语言或其明确指定的语言，不因英文协议或工具元数据切换语言。系统指令、只读命名空间树和经过转义的运行时状态全文记录为 plugin:ts_intellisense/context；补全与生成原文分别记录 plugin:ts_intellisense/intellisense 与 plugin:ts_intellisense/rewrite，以便重建实际请求。

`namespace.ts` 由实际 agent scope 的工具 schema、session Profile 及 YAML 别名生成 manifest。tools 命名空间暂时禁用：manifest 排除 tools 路径及 tools_* 管理工具，包括指向管理工具的别名；未挂载工具仅在存在有效自定义别名时可调用。补全不再返回 tools 内置签名，管理界面保留禁用的 tools 树及命令。别名参数重命名、schema 校验和权限检查均在宿主。子调用通过 tools.execute，传入 parent execution token/rootCallId，成对记录原生 PTC dispatch 事件，并向父执行传递 additionalContexts。拒绝在 VM 内表现为 rejected Promise。

`intellisense.ts` 提供 ctx.intellisense.complete 可选服务。静态清单和运行时 descriptor 内省按需返回成员或 TypeScript namespace/Doxygen 签名；命名空间/命令/用户注释保留原文。协议和补全元数据使用英文，原生错误不翻译；模型面向用户的回答遵循用户语言。注入净化与长度限制由协议层负责，完整原文仍入审计日志。

`route.ts` 注册可选 text-ptc provider 路由，模型 ID 为编码后的 upstream-provider/upstream-model；通过公开 llm 服务复用已经注册的 DeepSeek 等适配器及凭据，保留模型能力。常规会话也可保留界面选中的原 provider/model，由主请求 waterfall 执行同一新协议。卸载注销 provider、工具、监听器和进程。

`preset.ts` 从 presets/text_ptc/preset.yml 与 agent.cordis.yml 注册原生 Text PTC Agent Mode。能力组成基于已安装的 standard preset，保留规划、技能、工具和子代理约束，工具呈现为 native 以承载真实 exec。bundle 设置默认和 selectedDefault 为 text-ptc；已存在用户层配置优先于 bundle，需同步保存选择。

builtinVisible 为 Profile 的固定提示偏好，默认只包含自定义 vm 命令，标准 console 默认不提示。固定 UI 节点仍不可改名/移动/删除；tools 图钉禁用，其余图钉可切换。取消提示不改变可调用性。所有内置描述固定英文。

## 命名空间组件

`namespace_component.ts` 独立管理工具目录、会话 Profile、manifest 和初始提示词中的部分命名空间结构；PTC 适配器依赖它提供运行时映射。固定提示仅包含 Profile 固定的命令和命名空间，取消 console 子命令固定后不再出现在初始结构中；描述采用 Profile 简化注释。树使用 ts:namespace 和 namespace global 表示，完整成员和签名通过 IntelliSense 查询。补全函数参数文档内联到参数，属性注释保留在类型中，复杂对象使用具名类型以简化调用签名。补全示例使用行内代码并明确 exec 围栏不闭合。

`namespace_plugin.ts` 是可独立挂载的 `dsh-ts-intellisense/namespace` 入口，持有工具目录、Profile、管理 UI、补全服务与初始系统命名空间注入；无 codeRuntime 时保留原生工具 schema 并挂载 NamespaceAdapter。默认入口先提供 codeRuntime，再组合命名空间插件和 TextPtcAdapter，后者只依赖 NamespaceComponent 的 manifest、提示与补全审计接口。模型提示仅描述当前使用协议，不包含组件拆分及 tools 临时禁用等实现细节。
