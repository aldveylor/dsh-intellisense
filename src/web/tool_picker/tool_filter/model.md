# 工具类别筛选

`tool_filter.tsx` 提供受控多选筛选菜单，ToolCategory 区分未挂载、已挂载和内置固定工具。选中值由工具选择器管理；文字、勾选图标和空白区域均由同一个按钮响应，单击切换一次且保持菜单展开。组件负责 SVG 状态动画、整行复选菜单项（menuitemcheckbox）、菜单开合、外部点击与键盘关闭。样式沿用管理面板的主题变量和下拉菜单动画，减少动态效果偏好下停用图标过渡。

filter_icons.tsx 与 filter_icons.css 独立管理漏斗、标记和复选图标；通过 valid/open/active/checked 接收状态，悬停动画仅属于漏斗 Icon 自身。
