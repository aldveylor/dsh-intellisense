# 原生控件桥接

`action_button.tsx` 的 ActionButton 优先通过 ButtonContext 使用 DSH 原生 Button，保留 ref、事件及 HTML 属性。NativePanel 注入宿主组件；独立页面无宿主时使用带 data-variant/data-size 的普通 button，颜色、圆角、悬停与焦点使用 DSH token 和浅色/深色备用值。树节点图标和可编辑菜单保留已有布局与交互。

ActionButton 通过 HintButton 渲染带说明的操作提示，title 作为描述，按钮文字或可访问名称作为动作标题；管理页提供 TooltipProvider，保留原生 Button 注入和简短可访问名称。

`close_button.tsx` 提供共用 CloseButton，以 18px SVG 叉号替代关闭文字，按钮为 28px 方形，复用 ActionButton 的宿主桥接、悬停、键盘焦点和 Tooltip，保留本地化无障碍名称并允许调用方指定关闭说明。
