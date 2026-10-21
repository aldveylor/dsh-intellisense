# REPL 轨迹投影

`trajectory.ts` 使用原生 `uiConversation.events` 扩展 `trajectory` 视图，仅处理本插件 `ts-repl-*` 调用标识及其源码事件。

`protocol/execution_trace.ts` 定义前后端共享的 `ts-repl/source` 事件。事件携带 turn、step、callId、生成轮次 index、编辑起点 offset 和替换后缀 text；增量生成、续写、纠错清空与重写均使用同一编辑协议，不重复保存整份增长中的源码。取消或生成失败保留已生成内容；尚未开始逻辑调用时使用 interrupted 标记，已经开始时配对记录失败结果，不执行未校验代码。

`protocol/controller.ts` 在文本 delta 到达时通知源码预览，并屏蔽完整或跨块的控制标记和可选 Markdown 围栏；解析完成后同步真实缓冲，纠错重写时重置预览。`dsh/execution_trace.ts` 在生成前分配稳定 callId，源码流按生成轮次保存原始段（含终止标记），`ts_repl` 参数固定为 `codes: string[]`。第一次 IntelliSense 或执行之前写入逻辑 tool/call，每次 IntelliSense 都通过成对的原生 PTC 子调用记录查询位置与完整 CompletionResult（候选、签名、上下文）；重复位置复用结果及拒绝查询同样记录。通过编译校验后写入带完整 codes 的原生 assistant 调用，最终 tool/result 的 meta 同样保存完整 codes。最终对话继续使用执行结果，不流出待执行源码。

每条调用按 callId 独立投影，并独占源码事件及 REPL assistant 事件的 trajectory 目标。投影状态保存 codes 数组和中断标记，从首个源码片段立即显示并保留最初的 seq、turn 和 step，供宿主关联工具结果及 PTC 子调用；不会提前结算原生 assistant。最终回复和思考流继续使用原生 assistant 投影，实时增量与历史回放遵循同一规则。没有源码事件的既有执行记录仍可直接按原生 assistant 调用还原。

原生 request/header 保留 VM 可调用工具的 schema，供轨迹按调用标识关联子工具定义；适配器发送到上游的 tools 仍为空。
