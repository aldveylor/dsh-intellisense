# 客户端节点投影

tree_node.ts 定义共享 Node 的浏览器基类与 TreeRenderer。command_tree_node.ts 和 namespace_tree_node.ts 提供普通 leaf/tree，路径由 parent 引用派生；namespace_tree_node.remove 检查子节点 removable。

provided_command_tree_node.ts 和 provided_namespace_tree_node.ts 代理服务端 SerializedNode 和 Permission。客户端不定义 tools 名称规则，不推断受保护节点的权限；固定等级、禁用、删除、移动和插入操作读取服务端权限。

上层 panel/tree_node.ts 组织普通匿名根、服务端子树与草稿映射并排序；tree_provider.ts 负责序列化协议到视图的转换。无专用根节点类型。

CommandTreeNode 对应单个挂载路径，其 Mapping 独立持有该路径的固定等级、禁用状态与简化描述。

命名空间 children 为只读视图，构造及编辑通过 add/remove 修改成员并使祖先计数缓存失效；sort 仅调整顺序。普通节点首次读取 count 缓存递归结果，整树构造后预热；服务端子树继续显示直接成员数。

普通命令和命名空间同样读取服务端 nodeSettings 中的递归权限。构造已有子节点时不使用 acceptsChildren 过滤成员，该权限仅限制新增编辑。
