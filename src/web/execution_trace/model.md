# REPL 轨迹投影

`trajectory.ts` 使用原生 `uiConversation.events` 扩展 `trajectory` 视图，仅处理本插件 `ts-repl-*` 调用标识的 `ts_repl` assistant 记录。宿主按 turn/step 合并 assistant 结算，因此同一步最终回复会覆盖先前执行记录。

最终回复落盘前由原生投影显示执行调用；最终回复落盘后，本投影按原始 seq、turn 和 step 补回调用节点，供宿主关联已有的工具结果和 PTC 子调用。原生最终回复继续由宿主显示，不增加请求或工具派发。历史回放复用相同逻辑，未加载调用记录时不伪造节点。
