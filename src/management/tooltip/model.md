# 悬浮提示

`tooltip.tsx` 提供 TooltipProvider、Tooltip 与 useTooltip。Provider 共享一个浮层，Tooltip 使用 popover 顶层以覆盖模态对话框并避免滚动区域裁切。鼠标移动直接更新浮层坐标，不触发工具卡片重渲染；浮层在视口边缘翻转、限位。锚点控制进入、离开和键盘聚焦；滚动及 Escape 关闭提示。
