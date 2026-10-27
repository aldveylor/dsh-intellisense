# 查询记录模型

`events.ts` 定义普通 tools.inspect 查询的审计数据：原生 turn/step、查询列表、完整查询结果（PTC 为 TypeScript 声明，native 为 JSON 成员和工具契约）、耗时、Profile revision 和 runtime epoch。

执行由原生 DSML 与 tools_run_code 工具流程负责。本组件不解析输出、控制标记或代码围栏，不提供执行续写或历史投影。

`events.ts` 定义内置命令 `builtin` 审计：工具契约、参数、结果、语言、耗时和错误状态，供轨迹代码块展示使用。

`code_block.ts` 提供安全 Markdown 代码围栏，供工具展示回调与客户端审计详情共用；围栏长度随内容中的反引号增长。
