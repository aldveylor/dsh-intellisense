# 命名空间树视图

`namespace_tree_view.tsx` 组织递归渲染与共享 Tooltip，`tree_props.ts` 定义树数据和草稿操作接口；视图仅调用上层操作，不保存 Profile 草稿。

`namespace_node/` 渲染命名空间块，接收递归内容；`tree_children/` 保持展开容器及收起过渡后的内容清理。`command_node/` 渲染命令行，`namespace_placeholder/` 提供新增命名空间、选择工具和空位拖放。`../../controls/editable_text.tsx` 提供共享局部文本编辑，`tree_controls/` 共享固定、禁用和删除按钮，`native_drag.ts` 处理原生拖动反馈。保留原有 DOM 层级、类名、权限和事件行为。
