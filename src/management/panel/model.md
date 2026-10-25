# 工具树管理面板

`management_panel.tsx` 管理草稿、保存、命名空间编辑、内置提示图钉和整理会话草稿入口。`namespace_tree.ts` 处理路径及树变换，`tree_drag.ts` 处理指针拖动，`tree_provider.ts` 投影服务端序列化节点并筛选未挂载工具。样式保存在同目录的 `management_panel.css`。

`tools.intellisense` 固定映射内置 tools_intellisense，始终提示且不可取消固定、改名、拖动或删除，其图钉锁定详细等级 2；tools.profile 子树仅显示 annotation、commands、load、save，均可按 0/1/2 切换提示等级。

普通命令图钉点击按 0（不固定）→ 1（简略）→ 2（详细）→ 0 循环，等级 2 使用黄色实心图钉。草稿及挂载/移除映射均保留完整等级；命名空间图钉保留布尔开关。树中的固定及关闭图标均为 18px，按钮保持 26px，无边框。

命名空间块统一显示当前层级名称，固定子树 tools.profile 显示 profile，悬停保留完整路径。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；不使用 console 专有存储字段。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

除可切换固定提示的 console 外，固定命名空间（tools、tools.profile）显示禁用的实心固定图标，提示固定命名空间不可修改；不改变命令各自的提示等级。

顶部工具栏保留“配置文件:” / “Profile:”标签和仅用于设置默认配置的下拉框，隐藏配置管理操作；生成整理提案按钮右对齐。命名空间树标题行右侧的 div 放置独立编辑 Profile 下拉框及刷新、保存、另存为无边框 SVG 图标按钮，不显示 Profile 文本标签。树的配置选择不切换默认 Profile，在编辑下拉框底部输入名称并按 Enter 新增本地草稿，点击保存才持久化；默认选择变化时保留编辑草稿。生成整理提案按钮使用原生客户端注入的 organize 能力，以默认模型创建 Intellisense PTC 新对话，预填本地化提示，等待用户手动提交。独立管理页面无原生会话导航能力时禁用该按钮。

管理面板通过同一 profileDraft 投影生成修改判定和保存载荷：映射仅提取当前 Mapping 定义的字段，不透传 enabled 等额外属性；统一补齐可选字段、裁剪映射路径与别名、移除空别名，并按相同的固定节点和实际路径计算顺序。当前草稿与服务端快照均先规范化，避免仅路径空白或顺序默认值差异导致保存后仍显示已修改。

`error_dialog.tsx` 使用原生模态弹窗展示操作错误及无效编辑反馈，支持确认按钮和 Escape 关闭。保存、另存为和刷新不显示过程状态提示；加载、切换配置及打开整理对话保留过程状态。

树中 tools.search 默认不固定，图钉支持全部等级，禁用状态随当前 Profile 保存。方法签名从服务端实际工具 schema 的 method 枚举投影。自定义命令及命名空间支持禁用按钮，位置在删除按钮左侧；禁用节点保留可编辑状态并变灰。

启用与禁用按钮图标表示当前状态：启用显示圆圈加号，禁用显示圆圈斜线；按钮文字提示仍描述点击后的操作。

拖动到命名空间中心时高亮目标节点；前后插入时，在目标同级节点之间绘制横线。命名空间之后的插入线位于完整展开子树之后，不贴在标题块边缘。

`tree_nodes/` 按类拆分客户端节点，统一实现 Node 接口和 leaf/tree 类型，详见其 model.md。`tree_node.ts` 只负责组织 NamespaceTree：普通匿名 NamespaceTreeNode 作为根，组合服务器描述的受保护子树和本地草稿映射，路径从 parent 引用派生。父节点 remove 检查子节点 permissions.removable。

服务端 API 的 provided 字段传递完整 SerializedNode 子树及 Permission，包括 removable 和 availableFixLevels；TreeProvider 不导入内置命令表、不按名称分类。ProvidedCommandTreeNode 和 ProvidedNamespaceTreeNode 仅代理这些描述。固定、禁用、删除、拖动和插入均读取权限。固定状态通过通用 namespaceVisible 路径映射保存；协议无 consolePinned/pinField 等特殊字段。受保护命令按钮从左到右为禁用、固定；不可禁用时不渲染禁用按钮，固定等级只有一个选择时锁定。

命名空间与命令节点及其按钮、可编辑文本在聚焦时不显示高亮边框或焦点轮廓；输入框编辑状态、无效命令边框和拖放位置反馈保持各自样式。

树行使用 TooltipProvider 共享浮层，移除名称和注释的原生 title。命名空间展示名称、路径、注释；命令展示名称、灰色命名空间、原始物理名、简化注释、完整文档、全局物理调用次数。原始名可打开工具卡片详情二层 Tooltip。标题后工具 SVG 按钮打开全部工具选择器；未挂载入口保留筛选。

加载快照通过 profileDraft 统一规范化顺序，保留受保护根节点的顺序，避免仅加载配置就显示未保存标记。
