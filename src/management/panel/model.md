# 工具树管理面板

`management_panel.tsx` 管理草稿、保存、命名空间编辑、内置提示图钉和维护提案确认。`namespace_tree.ts` 处理路径及树变换，`tree_drag.ts` 处理指针拖动，`tree_provider.ts` 定义固定的 tools、console、vm 节点与未挂载工具筛选。样式保存在同目录的 `management_panel.css`。

`tools.intellisense` 固定映射内置 tools_intellisense，始终提示且不可取消图钉、改名、拖动或删除；其余 tools 管理命令仍显示为禁用。
