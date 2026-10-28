# 命名空间编辑区域

`namespace_section.tsx` 组合区域标题、工具入口、ProfilePicker、未挂载工具统计、简介编辑入口、命名空间树和操作提示及 inspect 警告。组件接收已投影的数据和操作回调，Profile 草稿、请求及弹窗状态由上层 management_panel 管理。Profile 操作和树区域分别保留请求期间的 inert 控制。

配置描述以浅色文本展示，空白时显示“双击添加配置描述”，双击或键盘 Enter 在原位置切换为编辑栏；失焦或 Enter 更新草稿，Escape 取消，清空后恢复占位文字。未挂载工具按钮位于树下方操作提示的右侧。
