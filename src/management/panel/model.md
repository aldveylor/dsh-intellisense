# 工具树管理面板

`management_panel.tsx` 管理草稿、保存、命名空间编辑、内置提示图钉和整理会话草稿入口。`namespace_tree.ts` 处理路径及树变换，`tree_drag.ts` 处理指针拖动，`tree_provider.ts` 定义固定的 tools、console 节点与未挂载工具筛选。样式保存在同目录的 `management_panel.css`。

`tools.intellisense` 固定映射内置 tools_intellisense，始终提示且不可取消固定、改名、拖动或删除，其图钉锁定详细等级 2；tools.profile 子树仅显示 annotation、commands、load、save，均可按 0/1/2 切换提示等级。

普通命令图钉点击按 0（不固定）→ 1（简略）→ 2（详细）→ 0 循环，等级 2 使用黄色实心图钉。草稿及挂载/移除映射均保留完整等级；命名空间图钉保留布尔开关。树中的固定及关闭图标均为 18px，按钮保持 26px，无边框。

命名空间块统一显示当前层级名称，固定子树 tools.profile 显示 profile，悬停保留完整路径。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

除可切换固定提示的 console 外，固定命名空间（tools、tools.profile）显示禁用的实心固定图标，提示固定命名空间不可修改；不改变命令各自的提示等级。

顶部工具栏保留“配置文件:” / “Profile:”标签和仅用于设置默认配置的下拉框，隐藏配置管理操作；生成整理提案按钮右对齐。命名空间树标题行右侧的 div 放置独立编辑 Profile 下拉框及刷新、保存、另存为无边框 SVG 图标按钮，不显示 Profile 文本标签。树的配置选择不切换默认 Profile，在编辑下拉框底部输入名称并按 Enter 新增本地草稿，点击保存才持久化；默认选择变化时保留编辑草稿。生成整理提案按钮使用原生客户端注入的 organize 能力，以默认模型创建 Intellisense PTC 新对话，预填本地化提示，等待用户手动提交。独立管理页面无原生会话导航能力时禁用该按钮。

管理面板通过同一 profileDraft 投影生成修改判定和保存载荷：统一补齐可选字段、裁剪映射路径与别名、移除空别名，并按相同的固定节点和实际路径计算顺序。当前草稿与服务端快照均先规范化，避免仅路径空白或顺序默认值差异导致保存后仍显示已修改。

`error_dialog.tsx` 使用原生模态弹窗展示操作错误及无效编辑反馈，支持确认按钮和 Escape 关闭。保存、另存为和刷新不显示过程状态提示；加载、切换配置及打开整理对话保留过程状态。

树中 tools.search 默认不固定，图钉支持全部等级，禁用状态随当前 Profile 保存。方法签名从服务端实际工具 schema 的 method 枚举投影。自定义命令及命名空间支持禁用按钮，位置在删除按钮左侧；禁用节点保留可编辑状态并变灰。

启用与禁用按钮图标表示当前状态：启用显示圆圈加号，禁用显示圆圈斜线；按钮文字提示仍描述点击后的操作。

拖动到命名空间中心时高亮目标节点；前后插入时，在目标同级节点之间绘制横线。命名空间之后的插入线位于完整展开子树之后，不贴在标题块边缘。

`tree_node.ts` 的抽象 `TreeNode` 实现 `integration/node.ts` 的共享 `Node` 接口。`CommandTreeNode`、`NamespaceTreeNode`、`BuiltinCommandTreeNode`、`BuiltinNamespaceTreeNode`、`RootNamespaceTreeNode` 分别对应 integration 的五类节点及 type。`NamespaceTree.root` 是匿名根，节点持有 parent 引用，命名空间持有直接 children 引用；path 仅由父节点链派生。`resolve(parts)` 沿子节点查找；`serialize()` 和 `toJSON()` 输出共享节点快照，不包含 parent，避免循环引用。树从 Profile 与内置 provider 输入建立，按 Profile 排序，管理面板通过 render 接口递归渲染。

宿主与 UI 共用 `nodePermissions`、`fixLevel`、`nextFixLevel`；provider 只保存 permissions，不再额外保存 fixed/draggable 状态。内置命令的图钉按其 fixLevels 循环，仅一个可选等级时锁定；tools.intellisense 仅允许等级 2 且不可禁用。禁用按钮及操作回调读取 permissions.disable，不允许禁用时不渲染禁用图标；继承命名空间禁用时，同样按命令权限保留不可禁用命令。内置命令操作区从左到右为禁用、固定，普通命令保持固定、禁用、删除。console 命名空间是否允许提示固定由共享权限决定，不再使用单独的 ConsoleNamespaceTreeNode 类。

`tools` 根命名空间不可禁用：共享 permissions.disable 为 false，UI 不显示禁用按钮且回调不允许禁用；registry 拒绝将 tools 写入 builtinDisabled。tools 下其余命令和 tools.profile 仍保留各自禁用权限，tools.intellisense 始终可用。
