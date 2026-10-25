# 管理界面

`client.ts` 注册原生插件设置面板及语言桥接，`standalone.tsx` 提供独立管理页面入口。`trajectory/` 将内置命令审计展示为踪迹上下文行，包含命令名、输入/输出 schema、参数、结果和耗时，TypeScript 声明与 JSON 数据使用代码块展示。`panel/` 实现工具树编辑，`profile_picker/` 与 `tool_picker/` 分别管理 Profile 与工具选择，`tooltip/` 提供共享的随指针移动浮层，`locale/` 提供翻译和原生界面桥接，`server/` 提供认证管理接口及页面。浏览器代码仅调用管理 API，不直接执行工具或访问存储。
