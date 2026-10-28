# 原生控件桥接

`action_button.tsx` 的 ActionButton 优先通过 ButtonContext 使用 DSH 原生 Button，保留 ref、事件及 HTML 属性。NativePanel 注入宿主组件；独立页面无宿主时使用带 data-variant/data-size 的普通 button，颜色、圆角、悬停与焦点使用 DSH token 和浅色/深色备用值。树节点图标和可编辑菜单保留已有布局与交互。

ActionButton 通过 HintButton 渲染带说明的操作提示，title 作为描述，按钮文字或可访问名称作为动作标题；管理页提供 TooltipProvider，保留原生 Button 注入和简短可访问名称。

`close_button.tsx` 提供共用 CloseButton，以 18px SVG 叉号替代关闭文字，按钮为 28px 方形，复用 ActionButton 的宿主桥接、悬停、键盘焦点和 Tooltip，保留本地化无障碍名称并允许调用方指定关闭说明。

`editable_text.tsx` 提供可复用的 EditableText：默认显示文本，双击或 Enter 进入编辑，Enter 或失焦提交，Escape 取消；编辑输入框沿用显示区域的宽高、字体、字号、字重、行高、字距、颜色、内边距及边框宽度，防止 input 默认样式改变文字大小或挤压文字区域，草稿保留在组件内，commit 返回 false 时保留编辑。支持只读、忙碌、空值、占位文本、长度限制、聚焦全选及 renderDisplay 自定义显示；由调用方提供本地化文案，树节点、配置简介与 Profile 菜单共用。
