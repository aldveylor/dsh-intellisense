# 内置工具审计与轨迹详情

`integration/builtin_trace.ts` 保留内置工具实际输入/输出 schema、参数、结果、耗时与错误审计。`builtin_trace.ts` 提供审计校验及安全代码围栏辅助，不注册独立轨迹列表行。

schema 的展示目标为宿主轨迹的工具/子工具详情 Schema 标签页。当前宿主 0.2.1-rc.2 的轨迹组件只从模型请求工具目录捕获 schema，PTC 请求仅包含 tools_run_code，因而子工具 schema 不可用。需要宿主扩展调用时 schema 的持久化与详情投影，再由插件提供实际子工具声明；插件审计本身尚不能填充该标签页。
