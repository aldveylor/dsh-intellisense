# 补全踪迹

`intellisense_trace.ts` 将 `plugin:ts_intellisense/intellisense` 审计事件注册为 trajectory 的独立上下文行，显示tools.intellisense 命令名、查询列表、TypeScript 返回声明和耗时。只读展示原有日志，不注入新的模型消息，也不模拟工具调用。注册由客户端的 uiConversation 依赖作用域管理，卸载时一并清理。

查询结果通过普通工具历史返回，原生 DSML 和 run_code 负责执行结果与错误的展示。
