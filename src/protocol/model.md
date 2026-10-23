# 文本执行协议

本组件是已启用的 text-ptc 模式协议层，由 index.ts / integration 适配器装配。

`config.ts` 使用 zod 验证 marker、段数、重复查询阈值、补全数据长度、上下文长度、整体缓冲上限及畸形输出策略；配置错误在构造时失败。

`syntax.ts` 识别行首 js:exec/ts:exec 围栏，缓存不完整围栏与 marker，解析 LINEBREAK/BREAK 及其审计注释，选择最后未放弃的程序。所有 exec 源码均缓存到 stop 后才转换为工具调用。围栏后的文本以及前序程序丢弃信息保存在审计事件中。执行围栏前行首泄漏的 DSML 原生调用标记（全角或 ASCII 竖线）按畸形协议处理，跨 chunk 缓存以避免原样展示；依照 malformedPolicy 共享一次完整重写机会，重复失败则结束为 error，原始输出保留审计。重写后的普通回答与执行前说明仍可流式展示。

`projection.ts` 是日志到上游消息的纯函数。合成 exec 调用还原为 js:exec 文本，对应结果转换为转义的 exec-result user 数据；相邻 user/assistant 合并，exec schema 移除。续写采用已核实适配器契约支持的 assistant 已生成文本 + user 续写指令，不依赖私有 prefix 接口。新建续写消息使用确定性 MessageId，不使用随机消息构造器。

`adapter.ts` 接收 inner.stream、请求独立的 turn/step 和 ProtocolHost。主循环保留流式 prose/reasoning，源码不外发。各段 usage 累计后仅发一次，正常结束生成完整 exec block 生命周期和 tool-calls finish，由原生 loop 执行，适配器自身不执行程序。内层非 stop、未闭合围栏重复修复、重复补全或超限转为 error finish。不支持 stop 选项，因为提供方会吞掉终止标记。取消传给上游与查询，并在每次向消费者 yield 前检查；取消后不再生成 chunk。

`events.ts` 通过 SessionEventMap 合并声明 exec/intellisense 与 exec/rewrite。ProtocolHost.audit 必须在对应输出或下一次请求前完成持久化，记录完整原始生成段、完整补全信息、实际净化注入数据、实际配置的补全 marker、查询上下文和耗时、丢弃前缀长度、代码哈希与丢弃内容。请求生命周期拥有 signal，完成/中断后统一 abort 清理。

执行语义已由用户明确：每次严格 AsyncFunction 的普通声明局部有效；显式 globalThis 状态才在同一存活进程内保留，重建后丢失。Agent 文本通道为 stdin/stdout，运行时控制/工具/补全为 IPC，console 结果不能污染 Agent stdout。

`tests/protocol/` 使用 fake inner adapter 验证协议输出和审计事件，不依赖真实模型。构建检查生产源码，类型检查覆盖保留的测试。旧 REPL 接口及专用测试已删除。
