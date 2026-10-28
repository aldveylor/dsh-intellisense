# 原生控件桥接

`action_button.tsx` 的 ActionButton 优先通过 ButtonContext 使用 DSH 原生 Button，保留 ref、事件及 HTML 属性。NativePanel 注入宿主组件；独立页面无宿主时使用带 data-variant/data-size 的普通 button，颜色、圆角、悬停与焦点使用 DSH token 和浅色/深色备用值。树节点图标和可编辑菜单保留已有布局与交互。
