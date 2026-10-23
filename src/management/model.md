# 管理界面

`client.ts` 注册原生插件设置面板及语言桥接，`standalone.tsx` 提供独立管理页面入口。`trajectory/` 将补全审计事件展示为踪迹上下文行，包含 tools.intellisense 命令名、查询列表、结果和耗时。`panel/` 实现工具树编辑，`profile_picker/` 与 `tool_picker/` 分别管理 Profile 与工具选择，`locale/` 提供翻译和原生界面桥接，`server/` 提供认证管理接口及页面。浏览器代码仅调用管理 API，不直接执行工具或访问存储。
