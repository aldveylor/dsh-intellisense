# REPL 轨迹投影

`trajectory.ts` 使用原生 `uiConversation.events` 扩展 `trajectory` 视图，仅处理本插件 `ts-repl-*` 调用标识的 `ts_repl` assistant 记录。

每条执行记录按 messageId 独立投影，并独占该事件的 trajectory 目标，避免原生按 turn/step 结算 assistant 时将正在流式展示的思考内容替换为执行调用。执行调用从到达时立即显示，保留原始 seq、turn 和 step，供宿主关联工具结果及 PTC 子调用；最终回复和思考流继续使用原生 assistant 投影。实时增量与历史回放遵循同一规则。

投影不保存额外业务状态，`start` 返回 `null`，`update` 保留该状态，满足宿主生命周期禁止返回 `undefined` 的约定。原生 request/header 保留 VM 可调用工具的 schema，供轨迹按调用标识关联子工具定义；适配器发送到上游的 tools 仍为空。
