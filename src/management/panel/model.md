# 工具树管理面板

`management_panel.tsx` 管理草稿、保存、命名空间编辑、内置提示图钉和维护提案确认。`namespace_tree.ts` 处理路径及树变换，`tree_drag.ts` 处理指针拖动，`tree_provider.ts` 定义固定的 tools、console、vm 节点与未挂载工具筛选。样式保存在同目录的 `management_panel.css`。

`tools.intellisense` 固定映射内置 tools_intellisense，始终提示且不可取消固定、改名、拖动或删除，其图钉锁定详细等级 2；tools.profile 子树仅显示 annotation、commands、load、save，均可按 0/1/2 切换提示等级。

普通命令图钉点击按 0（不固定）→ 1（简略）→ 2（详细）→ 0 循环，等级 2 使用黄色实心图钉。草稿及挂载/移除映射均保留完整等级；命名空间图钉保留布尔开关。

命名空间块统一显示当前层级名称，固定子树 tools.profile 显示 profile，悬停保留完整路径。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

除可切换固定提示的 console 外，固定命名空间（tools、tools.profile、vm）显示禁用的实心固定图标，提示固定命名空间不可修改；不改变命令各自的提示等级。
