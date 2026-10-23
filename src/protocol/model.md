# 查询记录模型

`events.ts` 定义普通 tools.intellisense 查询的审计数据：原生 turn/step、查询列表、完整查询结果（PTC 为 TypeScript 声明，native 为 JSON 成员和工具契约）、耗时、Profile revision 和 runtime epoch。`session_records.ts` 校验会话与浏览器读取的数据。

执行由原生 DSML 与 run_code 工具流程负责。本组件不解析输出、控制标记或代码围栏，不提供执行续写或历史投影。
