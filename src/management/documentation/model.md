# 内置使用文档

管理页“使用文档”按钮打开 UsageDialog，以当前界面语言显示 docs/en/usage.md 或 docs/zh-cn/usage.md，构建时作为文本纳入客户端，无需运行时读取 Markdown 文件。文档限定为段落、二级标题、行内代码和截图，通过 React 节点渲染，不解释 HTML。截图复用 README 的 assets/en 与 assets/zh 浅色图，使用经过认证的 ts-intellisense-docs-image 入口加载；语言和图片名称由枚举限制。

使用文档按用户视角介绍命名空间与 Profile 的用途、工具组织、Agent 可见范围和固定策略、页面布局与按钮操作、会话选择及整理流程；不包含 API、数据模型或内部实现说明。
