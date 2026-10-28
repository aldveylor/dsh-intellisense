# 内置使用文档

管理页标题后紧邻的问号 SVG 图标按钮（usage_button.tsx）打开 UsageDialog，以当前界面语言显示 docs/en/usage.md 或 docs/zh-cn/usage.md，构建时作为文本纳入客户端，无需运行时读取 Markdown 文件。文档限定为段落、二级标题、行内代码和截图，通过 React 节点渲染，不解释 HTML。截图复用 README 的 assets/en 与 assets/zh 浅色图，使用经过认证的 ts-intellisense-docs-image 入口加载；语言和图片名称由枚举限制。

使用文档按用户视角介绍命名空间与 Profile 的用途、工具组织、Agent 可见范围和固定策略、页面布局与按钮操作、会话选择及整理流程；不包含 API、数据模型或内部实现说明。

首次打开管理页且未查看文档时，图标右上角显示黄色提示点；点击后立即清除，并通过浏览器 localStorage 记录已查看状态，重新打开面板或刷新后不再提示。存储不可用时保留当前面板内的已查看状态。图标保留本地化无障碍名称及功能 Tooltip。

使用截图按操作分布：profile_editor 位于配置选择与保存、tools 位于添加工具、namespace_tree 位于名称注释与移动、tooltip 位于详情、新增 new_conversation 位于对话配置选择。“页面怎样排布”仅保留管理页与新对话入口的导览。新增图片同样通过严格枚举的认证路由加载。
