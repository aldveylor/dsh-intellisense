# 原生控件桥接

`action_button.tsx` 的 ActionButton 优先通过 ButtonContext 使用 DSH 原生 Button，保留 ref、事件及 HTML 属性。NativePanel 注入宿主组件；独立页面无宿主时使用带 data-variant/data-size 的普通 button，颜色、圆角、悬停与焦点使用 DSH token 和浅色/深色备用值。树节点图标和可编辑菜单保留已有布局与交互。

ActionButton 通过 HintButton 渲染带说明的操作提示，title 作为描述，按钮文字或可访问名称作为动作标题；管理页提供 TooltipProvider，保留原生 Button 注入和简短可访问名称。

`close_button.tsx` 提供共用 CloseButton，以 18px SVG 叉号替代关闭文字，按钮为 28px 方形，复用 ActionButton 的宿主桥接、悬停、键盘焦点和 Tooltip，保留本地化无障碍名称并允许调用方指定关闭说明。

`editable_text.tsx` 提供可复用的 EditableText：默认显示文本，双击或 Enter 打开编辑浮层，Enter 或失焦提交，Escape 取消；原显示元素始终保留在原位置占据布局空间。编辑浮层使用与 Tooltip 一致的 manual popover 浏览器顶层，脱离祖先 overflow 裁剪及层叠上下文，同时保留 DOM 归属，不触发菜单外部点击/焦点关闭。浮层保留显示态字体、字号、字重、行高及颜色，最小宽度 120px、高度 32px，允许超出原 block，在视口内定位并跟随滚动、窗口变化和锚点尺寸变化。草稿保留在组件内，commit 返回 false 时保留编辑。支持只读、忙碌、空值、占位文本、长度限制、聚焦全选及 renderDisplay 自定义显示；由调用方提供本地化文案，树节点、配置简介与 Profile 菜单共用。

EditableText 通过 InputContext 使用宿主原生 DSH Input，client.ts 和 NativePanel 注入，保留原生输入框外层边框、背景与内边距。独立页面无宿主时使用 HTML input 回退；不支持 popover 的环境回退为固定定位。
