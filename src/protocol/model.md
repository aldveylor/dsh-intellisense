# 文本执行协议

本组件是已启用的 text-ptc 模式协议层，由 index.ts / integration 适配器装配。

`config.ts` 使用 zod 验证 marker、段数、重复查询阈值、补全数据长度、上下文长度、整体缓冲上限及畸形输出策略；配置错误在构造时失败。

`syntax.ts` 识别行首 js:exec/ts:exec 围栏，缓存不完整围栏与 marker，解析 LINEBREAK/BREAK 及其审计注释，选择最后未放弃的程序。所有 exec 源码均缓存到 stop 后才转换为工具调用。围栏后的文本以及前序程序丢弃信息保存在审计事件中。执行围栏前行首泄漏的 DSML 原生调用标记（全角或 ASCII 竖线）按畸形协议处理，跨 chunk 缓存以避免原样展示；依照 malformedPolicy 共享一次完整重写机会，重复失败则结束为 error，原始输出保留审计。重写后的普通回答与执行前说明仍可流式展示。响应末尾位于 exec 围栏外或已闭合执行源码中的补全 marker 同样按畸形协议处理，修复失败则明确报错，避免清除 marker 后静默完成。

`projection.ts` 是日志到上游消息的纯函数。合成 exec 调用还原为 js:exec 文本，对应结果转换为转义的 exec-result user 数据；相邻 user/assistant 合并，exec schema 移除。续写采用已核实适配器契约支持的 assistant 已生成文本 + user 续写指令，不依赖私有 prefix 接口。新建续写消息使用确定性 MessageId，不使用随机消息构造器。

`adapter.ts` 接收 inner.stream、请求独立的 turn/step 和 ProtocolHost。主循环保留流式 prose/reasoning，源码不外发。各段 usage 累计后仅发一次，正常结束生成完整 exec block 生命周期和 tool-calls finish，由原生 loop 执行，适配器自身不执行程序。内层非 stop、未闭合围栏重复修复、重复补全或超限转为 error finish。不支持 stop 选项，因为提供方会吞掉终止标记。取消传给上游与查询，并在每次向消费者 yield 前检查；取消后不再生成 chunk。

`events.ts` 通过 PluginRecordMap 声明 plugin:ts_intellisense/intellisense、rewrite 与 context 扩展记录。ProtocolHost.audit 必须在对应输出或下一次请求前完成持久化，记录完整原始生成段、完整补全信息、实际净化注入数据、实际配置的补全 marker、查询上下文和耗时、丢弃前缀长度、代码哈希与丢弃内容。请求生命周期拥有 signal，完成/中断后统一 abort 清理。

执行语义已由用户明确：每次严格 AsyncFunction 的普通声明局部有效；显式 globalThis 状态才在同一存活进程内保留，重建后丢失。Agent 文本通道为 stdin/stdout，运行时控制/工具/补全为 IPC，console 结果不能污染 Agent stdout。

`tests/protocol/` 使用 fake inner adapter 验证协议输出和审计事件，不依赖真实模型。构建检查生产源码，类型检查覆盖保留的测试。旧 REPL 接口及专用测试已删除。

补全注入位于系统消息，续写 user 消息只负责请求继续。每次注入前提交原生 system/message，轨迹使用原生“系统提示词已更新”事件；补全审计继续保留查询、原文和净化数据。后续步骤按 Profile revision 与 VM epoch 恢复仍有效的补全。`session_records.ts` 验证浏览器及持久化补全记录，所有扩展记录通过 appendPluginRecord 写入 plugin: 名称并设置 ignorable，兼容当前 Session 格式验证与日志下载。

`namespace_adapter.ts` 为无 VM 的原生命名空间模式提供独立适配器。响应在交付前缓冲，任意分片的 IntelliSense marker 触发系统数据注入；BREAK 使当前响应的结构化工具调用及 DSML 调用块全部失效，注释仅进入审计。缺少正常 finish、超限或取消时不交付调用。`stream.ts` 共享取消等待与 usage 合并，不依赖执行运行时。

补全后先持久化审计，再使用 assembleContextFor / systemPrompt.assemble / renderPrompt 完整重生成提示词；新增的 system/message 保存完整结果，保留最初的提示词事件。续写投影仅发送重生成的完整系统消息，不拼接旧系统片段。completion_data.ts 按 HTML 语义解码实体，使用动态长度 Markdown 围栏承载声明，模型读取实际 `<`、`>`、`&` 字符。

初始系统提示词消息始终由原生首步装配完整生成并保留。补全更新使用相同 agent scope 重新调用所有提示词 provider 与 waterfall，新增完整 system/message，而非仅写入签名或更改旧消息内容；请求投影使用这次完整结果。回归检查覆盖原始人设保留及动态规则 provider 的重新求值。

终止协议错误在 rewrite 记录中保存结构化 failure（错误码与原始消息），并在输出 error finish 前完成持久化。修复尝试的 reason: error 不含 failure；即使同一生成段已保存修复审计，最终失败也单独写入带 failure 的记录。Text PTC 和独立命名空间模式采用相同错误审计格式。

畸形输出重试明确区分签名发现与程序执行，提供采用实际配置 marker 的未闭合 namespace 查询示例；发现分支要求在 marker 后立即结束，不再要求统一闭合执行围栏。
