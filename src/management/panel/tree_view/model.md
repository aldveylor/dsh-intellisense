# 命名空间树视图

`namespace_tree_view.tsx` 组织递归渲染与共享 Tooltip，`tree_props.ts` 定义树数据和草稿操作接口；视图仅调用上层操作，不保存 Profile 草稿。

树渲染体系保持独立；嵌套区域图由相邻 `../area_view/` 实现，不为原树节点添加布局模式。组件直接放在本目录，不再为单个 TSX 文件创建目录。

`namespace_node.tsx` 渲染命名空间块，接收递归内容，名称编辑按原始文本宽度，描述编辑显式启用多行，宽度回调取文本起点到右侧按钮区域之前的可用宽度并保留行间距；`tree_children.tsx` 保持展开容器及收起过渡后的内容清理。`command_node.tsx` 渲染命令行，名称编辑的宽度回调按当前字体取原始名称与 20 个字符宽度的较大值，`namespace_placeholder.tsx` 提供新增命名空间、选择工具和空位拖放。`../../controls/editable_text.tsx` 提供共享局部文本编辑，`tree_controls.tsx` 共享固定、禁用和删除按钮，`native_drag.ts` 处理原生拖动反馈。保留原有 DOM 层级、类名、权限和事件行为。
