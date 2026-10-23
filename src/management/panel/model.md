# 工具树管理面板

`management_panel.tsx` 管理草稿、保存、命名空间编辑、内置提示图钉和维护提案确认。`namespace_tree.ts` 处理路径及树变换，`tree_drag.ts` 处理指针拖动，`tree_provider.ts` 定义固定的 tools、console、vm 节点与未挂载工具筛选。样式保存在同目录的 `management_panel.css`。

`tools.intellisense` 固定映射内置 tools_intellisense，始终提示且不可取消固定、改名、拖动或删除，其图钉锁定详细等级 2；tools.profile 子树仅显示 annotation、commands、load、save，均可按 0/1/2 切换提示等级。

普通命令图钉点击按 0（不固定）→ 1（简略）→ 2（详细）→ 0 循环，等级 2 使用黄色实心图钉。草稿及挂载/移除映射均保留完整等级；命名空间图钉保留布尔开关。
