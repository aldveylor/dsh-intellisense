# 管理界面

`client.ts` 注册原生插件设置面板及语言桥接，`standalone.tsx` 提供独立管理页面入口。`trajectory/builtin_trace.ts` 仅转导出共享代码围栏辅助，不注册踪迹上下文行；内置命令的 schema、参数、结果、耗时及错误审计由 `tools/builtin_trace.ts` 写入。`panel/` 实现工具树编辑，`profile_picker/` 与 `tool_picker/` 分别管理 Profile 与工具选择，`animation/` 提供操作周期及行布局移动动画，`tooltip/` 提供共享的随指针移动浮层，`locale/` 提供翻译和原生界面桥接，`server/` 提供认证管理接口及页面。浏览器代码仅调用管理 API，不直接执行工具或访问存储。

code_block/ 提供代码渲染上下文；client.ts 向 NativePanel 注入宿主 ui-primitives 的 CodeBlock，工具返回类型使用 TypeScript 高亮及复制按钮，独立页面使用可移植代码展示。

package.json 的 dsh.client.inject 显式声明客户端服务提供包 ui-renderer（slots）、locale、api-session-controller（sessions）、ui-workspace、ui-conversation 和 ui-layout，以及提供 plugins.bundle.config 插槽的 ui-plugin-manager。ui-slots 与 ui-primitives 为共享模块，不作为客户端插件依赖声明。

`session_profile/` 在已有会话的首页 preset 右侧提供原生 Profile 菜单，只在当前作用域启用 intellisense-presentation 时显示；切换只加载当前会话命名空间。详见 session_profile/model.md。
