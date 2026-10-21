# 配置选择器

`native_select.tsx` 用 DSH `Menu`、`Button` 和下箭头图标实现全局/session 配置选择。菜单在 portal 中渲染，复用原生选中标记、键盘导航和关闭行为。以独立的菜单 ID 区分全局与任意 session ID，禁用时关闭菜单。

组件实现 `ManagementPanel` 的 `ConfigurationSelectProps`，仅由宿主入口注入；独立认证页面保留浏览器选择器。原生构建将 DSH primitives 标记为外部依赖，使用宿主同一组件实例和样式。
