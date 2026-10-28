# 共享图标

`icon.tsx` 定义统一 IconProps.valid：只控制动画是否可用，不抹除已选、固定、禁用等静态状态。`icons.tsx` 提供关闭、添加、工具、帮助、箭头、固定和禁用图标；动态状态通过 open/active/level/disabled 参数显式传入，图标动画样式由 icons.css 管理，外部按钮不通过 aria/data 属性控制 SVG 动画。

Icon 的 useIconStyles 在 document.head 按样式内容去重、计数挂载并在最后一个使用者卸载时移除，避免样式文本混入按钮内容。Icon 的 valid=false 停用动画与过渡，但保留静态状态；悬停选择器仅属于图标自身，不选择外层按钮。
