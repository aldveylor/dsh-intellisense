# 代码块

CodeBlockContext 由宿主客户端注入 DSH ui-primitives 的 CodeBlock，TypeScriptBlock 使用 TypeScript 高亮及本地化复制按钮。独立页面未注入宿主组件时使用 pre/code 展示，避免将宿主 CSS 模块及高亮运行环境打包入独立页面。
