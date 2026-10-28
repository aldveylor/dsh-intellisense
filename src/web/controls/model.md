# 原生控件桥接

`action_button.tsx` 的 ActionButton 优先通过 ButtonContext 使用 DSH 原生 Button，保留 ref、事件及 HTML 属性。NativePanel 注入宿主组件；独立页面无宿主时使用带 data-variant/data-size 的普通 button，颜色、圆角、悬停与焦点使用 DSH token 和浅色/深色备用值。树节点图标和可编辑菜单保留已有布局与交互。

ActionButton 通过 HintButton 渲染带说明的操作提示，title 作为描述，按钮文字或可访问名称作为动作标题；管理页提供 TooltipProvider，保留原生 Button 注入和简短可访问名称。

`close_button.tsx` 提供共用 CloseButton，以 18px SVG 叉号替代关闭文字，按钮为 28px 方形，复用 ActionButton 的宿主桥接、悬停、键盘焦点和 Tooltip，保留本地化无障碍名称并允许调用方指定关闭说明。

`editable_text.tsx` 提供可复用的 EditableText：默认显示文本，双击或 Enter 打开编辑浮层，Enter 或失焦提交，multiline 默认 false，开启后 Shift+Enter 换行；单行模式 Enter（包括 Shift+Enter）提交，粘贴换行转为空格，Escape 取消；原显示元素始终保留在原位置占据布局空间。编辑浮层使用与 Tooltip 一致的 manual popover 浏览器顶层，脱离祖先 overflow 裁剪及层叠上下文，同时保留 DOM 归属，不触发菜单外部点击/焦点关闭。浮层保留显示态字体、字号、字重、行高及颜色，autoWidth 默认 false，编辑内容宽度默认按原始文本的完整渲染宽度计算，不随草稿长度变化；开启 autoWidth 后铺满原显示元素父容器的内容区域；calculateWidth 回调优先于默认宽度及 autoWidth，接收 element、textElement、文本起点 textLeft、原文渲染宽度 textWidth 和同字体测量函数 measureText，返回内容宽度（像素），替代 minWidth 参数；所有模式均受视口宽度限制；多行 textarea 按换行后的 scrollHeight 增高及缩回，单行保持一行高度并横向滚动，编辑器最小边框高度为原显示区域高度加上下内边距及边框与 32px 的较大值，超出视口高度后内部滚动，允许超出原 block，在视口内定位并跟随滚动、窗口变化和锚点尺寸变化。草稿保留在组件内，commit 返回 false 时保留编辑。支持只读、忙碌、空值、占位文本、长度限制、聚焦全选及 renderDisplay 自定义显示；由调用方提供本地化文案，树节点、配置简介与 Profile 菜单共用。

EditableText 通过 InlineEditorContext 使用宿主原生 DSH InlineEditor，client.ts 和 NativePanel 注入，保留原生编辑器边框与背景，统一内边距以适配浮层尺寸。独立页面无宿主时使用 HTML textarea 回退；不支持 popover 的环境回退为固定定位。

浮层定位以原文本首行的内容起点为准，扣除编辑器相对浮层的位置、边框及内边距；相对位置通过 DOM 矩形测量，包含 margin 偏差。自定义显示可向 beginEdit 传入独立 textElement，Profile 菜单使用名称元素定位，避免勾选图标与简介影响起点。视口边缘仍优先保证浮层可见。

浮层宽度额外包含左右 margin、边框和内边距；浮层高度包含编辑器边框高度及上下 margin，保证扣除两侧 offset 后仍覆盖目标内容区域。左右、上下 offset 始终分别求和，视口边界仍限制最大尺寸。

`icon.tsx` 定义统一 IconProps.valid：只控制动画是否可用，不抹除已选、固定、禁用等静态状态。`icons.tsx` 提供关闭、添加、工具、帮助、箭头、固定和禁用图标；动态状态通过 open/active/level/disabled 参数显式传入，图标动画样式由 icons.css 管理，外部按钮不通过 aria/data 属性控制 SVG 动画。

Icon 的 useIconStyles 在 document.head 按样式内容去重、计数挂载并在最后一个使用者卸载时移除，避免样式文本混入按钮内容。Icon 的 valid=false 停用动画与过渡，但保留静态状态；悬停选择器仅属于图标自身，不选择外层按钮。
