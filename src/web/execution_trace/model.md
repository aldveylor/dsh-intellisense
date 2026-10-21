# REPL 轨迹投影

`trajectory.ts` 使用原生 `uiConversation.events` 扩展 `trajectory` 视图，仅处理本插件 `ts-repl-*` 调用标识及其源码事件。

`protocol/execution_trace.ts` 定义前后端共享的 `ts-repl/source` 事件。事件携带 turn、step、callId、编辑起点 offset 和替换后缀 text；增量生成、续写、纠错清空与重写均使用同一编辑协议，不重复保存整份增长中的源码。取消或生成失败使用 interrupted 标记保留已生成内容，不产生物理调用或工具结果。

`protocol/controller.ts` 在文本 delta 到达时通知源码预览，并屏蔽完整或跨块的控制标记和可选 Markdown 围栏；解析完成后同步真实缓冲，纠错重写时重置预览。`dsh/execution_trace.ts` 在生成前分配稳定 callId，源码流仅记录展示事件，通过编译校验后才写入原生 assistant 调用和 tool/call。最终对话继续使用执行结果，不流出待执行源码。

每条调用按 callId 独立投影，并独占源码事件及 REPL assistant 事件的 trajectory 目标。投影状态保存源码和中断标记，从首个源码片段立即显示并保留最初的 seq、turn 和 step，供宿主关联工具结果及 PTC 子调用；不会提前结算原生 assistant。最终回复和思考流继续使用原生 assistant 投影，实时增量与历史回放遵循同一规则。没有源码事件的既有执行记录仍可直接按原生 assistant 调用还原。

原生 request/header 保留 VM 可调用工具的 schema，供轨迹按调用标识关联子工具定义；适配器发送到上游的 tools 仍为空。
