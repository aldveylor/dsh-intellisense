# 执行协议模型

`adapter.ts` 仅用于 Intellisense PTC 模式：缓存 js:exec/ts:exec 围栏源码，在正常 stop 后合成一个 exec 调用，由原生 AgentLoop 执行。无执行围栏时交付普通回答；非正常结束不会执行。取消传播到上游，输出长度受配置限制，usage 按响应合并。

`syntax.ts` 只解析执行围栏，不解释源码中的控制标记。选取最后一个执行块，其余块和尾部文本写入 rewrite 审计。不完整围栏或泄漏原生 DSML 可按 malformedPolicy 完整重写一次，不进行源码续写或补全中断。

`projection.ts` 将历史 exec 调用投影为围栏、结果投影为用户数据。签名查询通过普通 tools.intellisense 调用完成，结果随原生工具历史返回；不再注入系统提示词或自动续写。Intellisense 模式直接使用原生 DSML 工具流，不经过本协议适配器。

`events.ts` 与 `session_records.ts` 定义查询列表、完整 TypeScript 查询结果和提取审计记录，供会话日志与轨迹界面使用。
