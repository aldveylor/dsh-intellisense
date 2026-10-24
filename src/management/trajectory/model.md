# 补全踪迹

`builtin_trace.ts` 将 `plugin:ts_intellisense/builtin` 审计事件注册为 trajectory 独立上下文行，显示内置工具名、实际输入/输出 JSON Schema、调用参数、结果与耗时。覆盖 tools.intellisense 和 tools.profile 的原生及 PTC 调用；失败调用保留 schema 并显示错误文本。

插件生成的轨迹标题与字段标签固定使用英文，不随管理界面语言切换；工具返回内容保持原样。轨迹详情使用 Markdown 代码围栏展示 schema 和 JSON 数据；PTC 补全声明及 Profile annotation 使用 TypeScript 代码块，错误使用 text 代码块。围栏长度随内容中的反引号增长，避免返回内容破坏展示结构。渲染只读取日志，不改变发送给模型的工具内容。

`plugin:ts_intellisense/intellisense` 查询审计仍保留 Profile revision 与 runtime epoch；轨迹统一使用 builtin 审计展示，移除旧补全投影及其记录读取器。

注册由客户端 uiConversation 依赖作用域管理，卸载时清理。内置工具仅在项目两个自定义 presentation 作用域注册，标准模式不产生这些记录。原生 DSML 和 tools_run_code 继续负责普通工具执行结果展示。
