# Text PTC 模式模型

`src/index.ts` 装配 Text PTC 模式。普通 AgentLoop 主请求交给 TextExecAdapter；标题、压缩和原生子代理不走该接管。原生循环拥有 exec 执行，适配器仅合成工具块，避免重复执行。

`adapter.ts` 注册宿主 exec 工具，并从 agent/request 获取真实 turn/step。每次请求保留原人设、技能、项目指令和模式策略；原工具协议分区由 assemble waterfall 移除，注入新的末尾 js:exec/ts:exec 协议，明确所有工具（含提问和展示）通过运行时命名空间调用，禁止输出原生工具调用或 DSML 标记。系统指令、浅层自定义命名空间和经过转义的运行时状态全文记录为 exec/context；补全与生成原文分别记录 exec/intellisense 与 exec/rewrite，以便重建实际请求。

`namespace.ts` 由实际 agent scope 的工具 schema、session Profile 及 YAML 别名生成 manifest。未挂载工具使用 tools.<encoded-id>，维护命令为 tools.mount/unmount/comment/fix/commit/profiles/loadprofile，不再暴露 unknown。别名参数重命名、schema 校验和权限检查均在宿主。子调用通过 tools.execute，传入 parent execution token/rootCallId，成对记录原生 PTC dispatch 事件，并向父执行传递 additionalContexts。拒绝在 VM 内表现为 rejected Promise。

`intellisense.ts` 提供 ctx.intellisense.complete 可选服务。静态清单和运行时 descriptor 内省按需返回成员或 TypeScript namespace/Doxygen 签名；命名空间/命令/用户注释保留原文。所有程序自有交互文案按英文设计，原生错误不翻译，也无语言检测。注入净化与长度限制由协议层负责，完整原文仍入审计日志。

`route.ts` 注册可选 text-ptc provider 路由，模型 ID 为编码后的 upstream-provider/upstream-model；通过公开 llm 服务复用已经注册的 DeepSeek 等适配器及凭据，保留模型能力。常规会话也可保留界面选中的原 provider/model，由主请求 waterfall 执行同一新协议。卸载注销 provider、工具、监听器和进程。

`preset.ts` 从 presets/text_ptc/preset.yml 与 agent.cordis.yml 注册原生 Text PTC Agent Mode。能力组成基于已安装的 standard preset，保留规划、技能、工具和子代理约束，工具呈现为 native 以承载真实 exec。bundle 设置默认和 selectedDefault 为 text-ptc；已存在用户层配置优先于 bundle，需同步保存选择。

builtinVisible 为 Profile 的固定提示偏好，默认只包含自定义 vm/tools 命令，标准 console 默认不提示。固定 UI 节点仍不可改名/移动/删除，但图钉可自由切换。取消提示不改变可调用性；tools.fix 也支持切换内置提示。所有内置描述固定英文。
