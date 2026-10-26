# 会话 Profile 选择器

`session_profile.tsx` 注册于原生 `conversation.hero.options`，在已有工作区会话的首页 agent preset 右侧显示 Profile 下拉框。复用宿主 Menu 的选中项、键盘交互、浮层及主题，按钮只展示配置文件名，不添加 Profile 前缀；与 agent preset 一样使用原生 title Tooltip，中文为“选择以设置Intellisense配置文件”，随宿主语言切换。按钮尺寸与 preset 一致；作用域样式将该项靠左排列，其余首页选项继续靠右。无会话时宿主不渲染该插槽。

`routes.ts` 注册 `/api/ts-intellisense-profile`，沿用 Connection 的认证和 Host/Origin 策略。GET 使用 session 查询参数，按当前 Agent 的 presentation 作用域判定 enabled，返回会话当前 Profile 与全局具名目录；POST 接收 `{ profile }`，只加载该会话的独立快照并调用 configurationChanged，刷新原生工具与系统提示词。未启用 presentation 的 preset 不显示菜单且禁止写入；native 与 ptc 均支持。不修改全局默认或其它会话。

preset 投影变化及窗口重新获得焦点时重新读取；切换请求完成前禁用选择，成功后才更新显示。异步代次丢弃旧会话、旧 preset 和旧刷新结果，错误通过 role=alert 显示。

配置界面“默认配置文件:”选择器修改全局目录默认项；新会话由 ProfileSessions 从当前默认项捕获独立快照，不沿用其它会话在首页选择的配置。
