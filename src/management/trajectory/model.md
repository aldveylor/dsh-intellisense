# 补全踪迹

`intellisense_trace.ts` 将 `exec/intellisense` 审计事件注册为 trajectory 的独立上下文行，显示实际协议 marker、补全查询、返回信息和耗时。只读展示原有日志，不注入新的模型消息，也不模拟工具调用。注册由客户端的 uiConversation 依赖作用域管理，卸载时一并清理。

补全轨迹读取并校验 `plugin:ts_intellisense/intellisense` 可忽略记录；对应的实际系统内容更新由原生 `system/message` 展示。
