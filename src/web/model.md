# Web 界面

`client.ts` 注册原生插件设置面板及语言桥接，`standalone.tsx` 提供独立管理页面入口。内置命令审计由 `../tools/builtin_trace.ts` 写入，安全代码围栏直接使用 `../protocol/code_block.ts`。`panel/` 实现工具树编辑，`profile_picker/` 与 `tool_picker/` 分别管理 Profile 与工具选择，`ui/animation/` 提供操作周期及行布局移动动画，`ui/tooltip/` 提供共享的随指针移动浮层，`locale/` 提供翻译，`panel/native_panel.tsx` 桥接宿主语言及控件，`server/` 提供认证管理接口及页面。浏览器代码仅调用管理 API，不直接执行工具或访问存储。

ui/code_block/ 提供代码渲染上下文；client.ts 向 NativePanel 注入宿主 ui-primitives 的 CodeBlock，工具返回类型使用 TypeScript 高亮及复制按钮，独立页面使用可移植代码展示。

package.json 的 dsh.client.inject 显式声明客户端服务提供包 ui-renderer（slots）、locale、api-session-controller（sessions）、ui-workspace、ui-conversation 和 ui-layout，以及提供 plugins.bundle.config 插槽的 ui-plugin-manager。ui-slots 与 ui-primitives 为共享模块，不作为客户端插件依赖声明。

`session_profile/` 在已有会话的首页 preset 右侧提供原生 Profile 菜单，只在当前作用域启用 intellisense-presentation 时显示；切换只加载当前会话命名空间。详见 session_profile/model.md。

客户端插件构建 external React、JSX runtime、ui-primitives 与 Zod，复用 DSH 宿主共享模块，并启用 minify；源码保持普通 import。standalone 独立页面继续打包自身依赖并压缩，不依赖宿主模块表。

`ui/` 集中可复用的展示辅助组件，包含 controls、icons、animation、tooltip 和 code_block；业务专用图标保留在所属功能目录。`profile/profile_json.ts` 提供前后端共用的 Profile JSON 校验，不依赖选择器组件。

浏览器权限查询依赖 ../profile/node_settings.ts 的普通数据查询函数；递归权限 schema 单独位于 ../profile/catalog/node_settings_schema.ts，由服务端目录写入消费，避免引入未使用的 Zod 初始化及语言包。

client.ts 显式导入 ui-layout/client 与 ui-conversation/client 的类型扩展，并将对应宿主包声明为开发依赖，以保证 ctx.layout 和 ctx.conversation 使用当前 DSH 接口。server/return_type.ts 从 dsh-tool-executor-ptc 获取 JSON Schema 的 TypeScript 类型投影。
