# 内置使用文档

管理页“使用文档”按钮打开 UsageDialog，以当前界面语言显示 docs/en/usage.md 或 docs/zh-cn/usage.md，构建时作为文本纳入客户端，无需运行时读取 Markdown 文件。文档限定为段落、二级标题、行内代码和截图，通过 React 节点渲染，不解释 HTML。截图复用 README 的 assets/en 与 assets/zh 浅色图，使用经过认证的 ts-intellisense-docs-image 入口加载；语言和图片名称由枚举限制。
